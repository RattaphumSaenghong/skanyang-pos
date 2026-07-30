import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { BillStatus, BillBatchStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  parseBillSheet,
  parseItemSheet,
  listSheetNames,
} from '../common/excel/bill-batch-parser';
import {
  match,
  BillInput,
  PoolItemInput,
  ServiceFeeInput,
} from '../bill-matcher/engine/matcher';
import { MAX_MULTIPLICITY } from '../bill-matcher/engine/archetypes';
import {
  closeGap,
  contextFromLines,
  suggestForBill,
} from '../bill-matcher/engine/suggest';
import { CloseGapDto } from './dto/close-gap.dto';
import { ImportBillBatchDto } from './dto/import-bill-batch.dto';
import { MatchRequestDto } from './dto/match-request.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { ServiceFeesService } from './service-fees.service';

function firstSheetOf(buffer: Buffer): string {
  const [name] = listSheetNames(buffer);
  if (!name) throw new BadRequestException('ไม่พบชีทในไฟล์ Excel');
  return name;
}

@Injectable()
export class BillMatcherService {
  constructor(
    private prisma: PrismaService,
    private serviceFees: ServiceFeesService,
  ) {}

  async listSheetNames(buffer: Buffer): Promise<string[]> {
    return listSheetNames(buffer);
  }

  /**
   * `billBuffer` and `itemBuffer` are the same buffer when the user uploads a
   * single workbook and picks two sheets from it.
   */
  async importBatch(
    billBuffer: Buffer,
    itemBuffer: Buffer,
    dto: ImportBillBatchDto,
    shopId: string,
  ) {
    // A file with one sheet needs no picker — default to its only sheet.
    const billSheet = dto.billSheet || firstSheetOf(billBuffer);
    const itemSheet = dto.itemSheet || firstSheetOf(itemBuffer);

    const billParsed = parseBillSheet(billBuffer, billSheet);
    const itemParsed = parseItemSheet(itemBuffer, itemSheet);

    if (billParsed.bills.length === 0) {
      throw new BadRequestException(
        `ไม่พบรายการบิลในชีท "${billSheet}" — ตรวจสอบหัวตาราง (ต้องมีคอลัมน์ วันที่ และ จำนวน)`,
      );
    }
    if (itemParsed.items.length === 0) {
      throw new BadRequestException(
        `ไม่พบรายการสินค้าในชีท "${itemSheet}" — ตรวจสอบหัวตาราง (ต้องมีคอลัมน์ ราคาขาย)`,
      );
    }

    // Check for existing batch
    const existing = await this.prisma.billBatch.findFirst({
      where: {
        shopId,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
      },
    });
    if (existing) {
      throw new BadRequestException('มีใบรวมนี้อยู่แล้ว');
    }

    // Transaction: create batch, bills, and pool items
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the batch
      const batch = await tx.billBatch.create({
        data: {
          shopId,
          label: dto.label,
          periodMonth: dto.periodMonth,
          periodYear: dto.periodYear,
          status: BillBatchStatus.DRAFT,
        },
      });

      // Insert all bills
      await tx.bill.createMany({
        data: billParsed.bills.map((b) => ({
          batchId: batch.id,
          seq: b.seq,
          billDate: b.date,
          amount: b.amount,
          status: BillStatus.UNMATCHED,
          locked: b.locked ?? false,
        })),
      });

      // Insert all pool items with sortOrder preserved
      await tx.billPoolItem.createMany({
        data: itemParsed.items.map((item) => ({
          batchId: batch.id,
          sortOrder: item.sortOrder,
          category: item.category,
          brand: item.brand,
          model: item.model,
          size: item.size,
          soldQty: item.soldQty,
          unitPrice: item.unitPrice,
          costExVat: item.costExVat,
        })),
      });

      return {
        batch,
        billCount: billParsed.bills.length,
        itemCount: itemParsed.items.length,
        warnings: [...billParsed.warnings, ...itemParsed.warnings],
      };
    });

    return {
      id: result.batch.id,
      label: result.batch.label,
      periodMonth: result.batch.periodMonth,
      periodYear: result.batch.periodYear,
      billCount: result.billCount,
      itemCount: result.itemCount,
      warnings: result.warnings,
    };
  }

  async findAllBatches(shopId: string) {
    return await this.prisma.billBatch.findMany({
      where: { shopId },
      include: { _count: { select: { bills: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBatchById(id: string, shopId: string) {
    const batch = await this.prisma.billBatch.findFirst({
      where: { id, shopId },
      include: {
        bills: {
          orderBy: { seq: 'asc' },
          include: { lines: true },
        },
        poolItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('ไม่พบใบรวมนี้');
    }

    return batch;
  }

  async matchBatch(id: string, shopId: string, dto: MatchRequestDto) {
    // Load batch, bills, pool items, and fees
    const batch = await this.prisma.billBatch.findFirst({
      where: { id, shopId },
      include: {
        bills: {
          orderBy: { seq: 'asc' },
          include: { lines: true },
        },
        poolItems: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('ไม่พบใบรวมนี้');
    }

    // Load all active service fees for this shop
    const fees = await this.serviceFees.findAll(shopId);

    // Build inputs for the matcher
    const billInputs: BillInput[] = batch.bills.map((b) => ({
      seq: b.seq,
      date: b.billDate,
      amount: b.amount,
      locked: b.locked,
      // Stored rows carry nulls and row ids the engine has no use for.
      existingLines: b.locked
        ? b.lines.map((l) => ({
            kind: l.kind,
            poolItemId: l.poolItemId ?? undefined,
            serviceFeeId: l.serviceFeeId ?? undefined,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          }))
        : undefined,
    }));

    const poolInputs: PoolItemInput[] = batch.poolItems.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      category: item.category,
      brand: item.brand,
      model: item.model,
      size: item.size,
      soldQty: item.soldQty,
      unitPrice: item.unitPrice,
      costExVat: item.costExVat,
    }));

    const feeInputs: ServiceFeeInput[] = fees.map((f) => ({
      id: f.id,
      name: f.name,
      minPrice: f.minPrice,
      maxPrice: f.maxPrice,
      maxQty: f.maxQty,
      group: f.group,
    }));

    // Run the matcher. Before month end the stock sheet's ขายรวม column is still
    // blank, and enforcing that as a ceiling would leave every bill on a bare
    // ค่าบริการ line — a useless first pass exactly when one is most wanted.
    const matchResult = match(billInputs, poolInputs, feeInputs, {
      timeBudgetMs: dto.timeBudgetMs,
      seed: dto.seed,
      unconstrained: await this.hasNoSoldQuantities(id),
    });

    // Persist results in a transaction.
    //
    // Locked bills are deliberately left alone end to end: their lines are
    // neither deleted nor re-inserted. Re-inserting them would duplicate every
    // line and silently double the bill on each re-run.
    const billIdBySeq = new Map(batch.bills.map((b) => [b.seq, b]));
    const unlocked = matchResult.bills.filter(
      (mb) => !billIdBySeq.get(mb.seq)?.locked,
    );
    const unlockedIds = unlocked
      .map((mb) => billIdBySeq.get(mb.seq)!.id)
      .filter(Boolean);

    const newLines = unlocked.flatMap((mb) => {
      const bill = billIdBySeq.get(mb.seq)!;
      return mb.lines.map((line) => ({
        billId: bill.id,
        kind: line.kind,
        poolItemId: line.poolItemId ?? null,
        serviceFeeId: line.serviceFeeId ?? null,
        description: line.description,
        qty: line.qty,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      }));
    });

    const matchedIds = unlocked
      .filter((mb) => mb.matched)
      .map((mb) => billIdBySeq.get(mb.seq)!.id);
    const unmatchedIds = unlocked
      .filter((mb) => !mb.matched)
      .map((mb) => billIdBySeq.get(mb.seq)!.id);

    await this.prisma.$transaction(
      async (tx) => {
        if (unlockedIds.length) {
          await tx.billLine.deleteMany({
            where: { billId: { in: unlockedIds } },
          });
        }
        if (newLines.length) {
          await tx.billLine.createMany({ data: newLines });
        }
        if (matchedIds.length) {
          await tx.bill.updateMany({
            where: { id: { in: matchedIds } },
            data: { status: BillStatus.MATCHED },
          });
        }
        if (unmatchedIds.length) {
          await tx.bill.updateMany({
            where: { id: { in: unmatchedIds } },
            data: { status: BillStatus.UNMATCHED },
          });
        }

        // Clear first: an item matched on the previous run but not on this one
        // would otherwise keep a stale matchedQty forever.
        await tx.billPoolItem.updateMany({
          where: { batchId: id },
          data: { matchedQty: 0 },
        });

        // Items sharing a quantity share one UPDATE — a few dozen statements
        // instead of one per SKU.
        const idsByQty = new Map<number, string[]>();
        for (const [poolItemId, qty] of Object.entries(
          matchResult.matchedByPoolItem,
        )) {
          if (qty <= 0) continue;
          const bucket = idsByQty.get(qty);
          if (bucket) bucket.push(poolItemId);
          else idsByQty.set(qty, [poolItemId]);
        }
        for (const [qty, ids] of idsByQty) {
          await tx.billPoolItem.updateMany({
            where: { id: { in: ids }, batchId: id },
            data: { matchedQty: qty },
          });
        }

        await tx.billBatch.update({
          where: { id },
          data: { status: BillBatchStatus.MATCHED, matchedAt: new Date() },
        });
      },
      { timeout: 30_000 },
    );

    return matchResult.stats;
  }

  async updateBill(
    batchId: string,
    billId: string,
    shopId: string,
    dto: UpdateBillDto,
  ) {
    // Verify batch ownership
    const batch = await this.prisma.billBatch.findFirst({
      where: { id: batchId, shopId },
    });
    if (!batch) {
      throw new NotFoundException('ไม่พบใบรวมนี้');
    }

    // Verify bill belongs to batch
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, batchId },
    });
    if (!bill) {
      throw new NotFoundException('ไม่พบบิลนี้');
    }

    // If toggling lock, just update it
    if (dto.locked !== undefined && dto.lines === undefined) {
      return await this.prisma.bill.update({
        where: { id: billId },
        data: { locked: dto.locked },
        include: { lines: true },
      });
    }

    // If replacing lines
    if (dto.lines !== undefined) {
      const lines = dto.lines;
      // A batch with no recorded sold quantities has no ceiling to enforce.
      const unconstrained = await this.hasNoSoldQuantities(batchId);
      const result = await this.prisma.$transaction(async (tx) => {
        // Read the outgoing lines BEFORE deleting them. An item that this edit
        // removes still needs its matchedQty recomputed, and once the rows are
        // gone there is no way to know which items those were.
        const outgoing = await tx.billLine.findMany({
          where: { billId },
          select: { poolItemId: true },
        });

        await tx.billLine.deleteMany({ where: { billId } });

        if (lines.length) {
          await tx.billLine.createMany({
            data: lines.map((line) => ({
              billId,
              kind: line.kind,
              poolItemId: line.poolItemId ?? null,
              serviceFeeId: line.serviceFeeId ?? null,
              description: line.description,
              qty: line.qty,
              unitPrice: line.unitPrice,
              lineTotal: line.lineTotal,
            })),
          });
        }

        const affected = new Set<string>();
        for (const l of outgoing) if (l.poolItemId) affected.add(l.poolItemId);
        for (const l of lines) if (l.poolItemId) affected.add(l.poolItemId);

        for (const poolItemId of affected) {
          const totalSold = await tx.billLine.aggregate({
            // Prisma v7.8.0 requires `is:` on nested to-one filters.
            where: { poolItemId, bill: { is: { batchId } } },
            _sum: { qty: true },
          });
          const poolItem = await tx.billPoolItem.findFirst({
            where: { id: poolItemId, batchId },
            select: { soldQty: true },
          });
          if (!poolItem) {
            throw new BadRequestException('รายการสินค้าไม่อยู่ในแบตช์นี้');
          }
          const matchedQty = totalSold._sum.qty ?? 0;
          if (!unconstrained && matchedQty > poolItem.soldQty) {
            throw new BadRequestException(
              `จำนวนที่จับคู่ (${matchedQty}) มากกว่าขายรวม (${poolItem.soldQty})`,
            );
          }
          await tx.billPoolItem.update({
            where: { id: poolItemId },
            data: { matchedQty },
          });
        }

        // Recalculate bill status (matched if lines sum to bill amount)
        const lineTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
        const matched = lineTotal === bill.amount;

        return await tx.bill.update({
          where: { id: billId },
          data: {
            status: matched ? BillStatus.MATCHED : BillStatus.UNMATCHED,
            locked: dto.locked ?? bill.locked,
          },
          include: { lines: true },
        });
      });

      return result;
    }

    // Just return the bill if nothing changed
    return await this.prisma.bill.findUnique({
      where: { id: billId },
      include: { lines: true },
    });
  }

  /**
   * Whether this batch records sold quantities at all.
   *
   * A stock sheet with ขายรวม (column I) left blank imports as soldQty 0 on every
   * row — which is the shop's actual June 2569 file. Zero there means "not
   * recorded", not "none sold", so enforcing it as a ceiling would refuse every
   * item on every bill and make the workbench inert. When the whole batch sums to
   * zero the ceiling is dropped instead. A batch that does carry quantities keeps
   * them enforced, and a 0 on one row there genuinely means none.
   */
  private async hasNoSoldQuantities(batchId: string): Promise<boolean> {
    const agg = await this.prisma.billPoolItem.aggregate({
      where: { batchId },
      _sum: { soldQty: true },
    });
    return (agg._sum.soldQty ?? 0) === 0;
  }

  /**
   * Load a bill together with the stock still free for it.
   *
   * Capacity deliberately ignores what this bill already holds: both callers
   * REPLACE its lines rather than adding to them, so its own units are back in
   * the pool from their point of view.
   */
  private async billWorkspace(
    batchId: string,
    billId: string,
    shopId: string,
  ) {
    const batch = await this.prisma.billBatch.findFirst({
      where: { id: batchId, shopId },
      include: { poolItems: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!batch) throw new NotFoundException('ไม่พบใบรวมนี้');

    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, batchId },
      include: { lines: true },
    });
    if (!bill) throw new NotFoundException('ไม่พบบิลนี้');

    // Aggregate the real line rows rather than trusting the matchedQty column,
    // so a suggestion can never hand out stock another bill is already using.
    const usedElsewhere = await this.prisma.billLine.groupBy({
      by: ['poolItemId'],
      // Prisma v7.8.0 requires `is:` on nested to-one filters.
      where: { bill: { is: { batchId } }, billId: { not: billId } },
      _sum: { qty: true },
    });
    const usedByItem = new Map<string, number>();
    for (const row of usedElsewhere) {
      if (row.poolItemId) usedByItem.set(row.poolItemId, row._sum.qty ?? 0);
    }

    const pool: PoolItemInput[] = batch.poolItems.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
      category: item.category,
      brand: item.brand,
      model: item.model,
      size: item.size,
      soldQty: item.soldQty,
      unitPrice: item.unitPrice,
      costExVat: item.costExVat,
    }));
    const unconstrained = await this.hasNoSoldQuantities(batchId);
    const capacity = unconstrained
      ? pool.map(() => MAX_MULTIPLICITY)
      : pool.map((item) =>
          Math.max(0, item.soldQty - (usedByItem.get(item.id) ?? 0)),
        );

    const fees = await this.serviceFees.findAll(shopId);
    const feeInputs: ServiceFeeInput[] = fees.map((f) => ({
      id: f.id,
      name: f.name,
      minPrice: f.minPrice,
      maxPrice: f.maxPrice,
      maxQty: f.maxQty,
      group: f.group,
    }));

    return { bill, pool, capacity, feeInputs };
  }

  /** The engine's shortlist for one bill, for the operator to pick from. */
  async suggestForBill(
    batchId: string,
    billId: string,
    shopId: string,
    limit?: number,
  ) {
    const { bill, pool, capacity, feeInputs } = await this.billWorkspace(
      batchId,
      billId,
      shopId,
    );
    return {
      billId,
      amount: bill.amount,
      suggestions: suggestForBill(
        bill.amount,
        pool,
        capacity,
        feeInputs,
        limit,
      ),
    };
  }

  /**
   * Service lines that close whatever `dto.lines` leaves short of the bill
   * amount. Nothing is persisted — the client folds these into its draft and
   * saves through updateBill.
   */
  async closeGapForBill(
    batchId: string,
    billId: string,
    shopId: string,
    dto: CloseGapDto,
  ) {
    const { bill, pool, feeInputs } = await this.billWorkspace(
      batchId,
      billId,
      shopId,
    );

    const draft = dto.lines ?? [];
    const gap =
      bill.amount - draft.reduce((sum, line) => sum + line.lineTotal, 0);
    if (gap <= 0) return { gap, lines: [] };

    const poolById = new Map(pool.map((item) => [item.id, item]));
    const lines = closeGap(gap, contextFromLines(draft, poolById), feeInputs);
    return { gap, lines: lines ?? [] };
  }

  async deleteBatch(id: string, shopId: string) {
    // Verify ownership
    const batch = await this.prisma.billBatch.findFirst({
      where: { id, shopId },
    });
    if (!batch) {
      throw new NotFoundException('ไม่พบใบรวมนี้');
    }

    // Cascade delete via Prisma (bills and items will cascade)
    return await this.prisma.billBatch.delete({
      where: { id },
    });
  }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { MovementType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  async findByShop(shopId: string | null) {
    // All-shops view (owner): show only products that have a StockItem
    if (!shopId) {
      return this.prisma.stockItem.findMany({
        where: { product: { is: { active: true } } },
        select: {
          id: true,
          shopId: true,
          qtyOnHand: true,
          qtyReserved: true,
          shop: { select: { id: true, name: true } },
          product: { select: { id: true, sku: true, brand: true, model: true, sizeNormalized: true, sizeWidth: true, sizeSeries: true, sizeRim: true, dotYear: true, isSetPricing: true } },
        },
        orderBy: [{ product: { sortOrder: 'asc' } }],
      });
    }

    // Shop-specific view: query Products so items with no StockItem still appear (qty 0)
    const products = await this.prisma.product.findMany({
      where: { shopId, active: true },
      include: {
        stockItems: { where: { shopId } },
        shop: { select: { id: true, name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return products.map((p) => ({
      id: p.stockItems[0]?.id ?? `virtual_${shopId}_${p.id}`,
      shopId,
      qtyOnHand: p.stockItems[0]?.qtyOnHand ?? 0,
      qtyReserved: p.stockItems[0]?.qtyReserved ?? 0,
      shop: p.shop,
      product: {
        id: p.id,
        sku: p.sku,
        brand: p.brand,
        model: p.model,
        sizeNormalized: p.sizeNormalized,
        sizeWidth: p.sizeWidth,
        sizeSeries: p.sizeSeries,
        sizeRim: p.sizeRim,
        dotYear: p.dotYear,
        isSetPricing: p.isSetPricing,
      },
    }));
  }

  async adjust(shopId: string, productId: string, qty: number, note: string, userId: string) {
    let item;
    if (qty < 0) {
      // Atomic: decrement only if sufficient stock exists
      const result = await this.prisma.stockItem.updateMany({
        where: { shopId, productId, qtyOnHand: { gte: -qty } },
        data: { qtyOnHand: { increment: qty } },
      });
      if (result.count === 0) {
        const current = await this.prisma.stockItem.findUnique({
          where: { shopId_productId: { shopId, productId } },
        });
        throw new BadRequestException(`สต็อกไม่เพียงพอ (มี ${current?.qtyOnHand ?? 0} ชิ้น)`);
      }
      item = await this.prisma.stockItem.findUnique({
        where: { shopId_productId: { shopId, productId } },
      });
    } else {
      item = await this.prisma.stockItem.upsert({
        where: { shopId_productId: { shopId, productId } },
        create: { shopId, productId, qtyOnHand: qty },
        update: { qtyOnHand: { increment: qty } },
      });
    }
    await this.prisma.stockMovement.create({
      data: { shopId, productId, type: qty > 0 ? MovementType.IN : MovementType.ADJUST, qty, note, createdBy: userId },
    });
    return item;
  }

  movements(shopId: string | null) {
    return this.prisma.stockMovement.findMany({
      where: shopId ? { shopId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async getSnapshots(shopId: string) {
    const snapshots = await this.prisma.stockSnapshot.findMany({
      where: { shopId, archived: false },
      include: { entries: { orderBy: { sku: 'asc' } } },
      orderBy: { takenAt: 'desc' },
      take: 6,
    });

    // Enrich entries with brand/model/dotYear from the Product table
    const productIds = [...new Set(snapshots.flatMap((s) => s.entries.map((e) => e.productId)))];
    if (productIds.length === 0) return snapshots;

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, brand: true, model: true, dotYear: true, sortOrder: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const enriched = snapshots.map((s) => ({
      ...s,
      entries: s.entries
        .map((e) => ({
          ...e,
          brand: productMap.get(e.productId)?.brand ?? '',
          model: productMap.get(e.productId)?.model ?? '',
          dotYear: productMap.get(e.productId)?.dotYear ?? null,
          sortOrder: productMap.get(e.productId)?.sortOrder ?? 9999,
          prevQtySystem: null as number | null,
          movements: [] as { qty: number; type: string; note: string | null; createdAt: Date }[],
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));

    // Attach movements between consecutive snapshots (desc order: [0]=newest)
    for (let i = 0; i < enriched.length; i++) {
      const current = enriched[i];
      const prev = enriched[i + 1];
      if (!prev) continue;

      const movements = await this.prisma.stockMovement.findMany({
        where: { shopId, createdAt: { gt: prev.takenAt, lte: current.takenAt } },
        orderBy: { createdAt: 'asc' },
        select: { productId: true, qty: true, type: true, note: true, createdAt: true },
      });

      const byProduct = new Map<string, typeof movements>();
      for (const m of movements) {
        const list = byProduct.get(m.productId) ?? [];
        list.push(m);
        byProduct.set(m.productId, list);
      }

      const prevQty = new Map(prev.entries.map((e) => [e.productId, e.qtySystem]));

      current.entries = current.entries.map((e) => ({
        ...e,
        prevQtySystem: prevQty.get(e.productId) ?? null,
        movements: byProduct.get(e.productId) ?? [],
      }));
    }

    return enriched;
  }

  async takeSnapshot(shopId: string, takenBy: string, label?: string) {
    const stockItems = await this.prisma.stockItem.findMany({
      where: { shopId, product: { is: { active: true } } },
      select: {
        productId: true,
        qtyOnHand: true,
        product: { select: { sku: true, brand: true, model: true, sizeNormalized: true, dotYear: true } },
      },
      orderBy: [{ product: { sortOrder: 'asc' } }],
    });

    const snapshot = await this.prisma.stockSnapshot.create({
      data: {
        shopId,
        takenBy,
        label,
        entries: {
          create: stockItems.map((item) => ({
            productId: item.productId,
            sku: item.product.sku,
            sizeNormalized: item.product.sizeNormalized,
            qtySystem: item.qtyOnHand,
            qtyActual: item.qtyOnHand,
          })),
        },
      },
      include: { entries: true },
    });

    const all = await this.prisma.stockSnapshot.findMany({
      where: { shopId, archived: false },
      orderBy: { takenAt: 'asc' },
    });
    if (all.length > 6) {
      await this.prisma.stockSnapshot.update({
        where: { id: all[0].id },
        data: { archived: true },
      });
    }

    return snapshot;
  }

  async dailyReport(shopId: string, date: string) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const movements = await this.prisma.stockMovement.findMany({
      where: { shopId, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'asc' },
    });

    const productIds = [...new Set(movements.map((m) => m.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, brand: true, model: true, sizeNormalized: true, sizeRim: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Aggregate per product
    const byProduct = new Map<string, { in: number; out: number; adjust: number }>();
    for (const m of movements) {
      const agg = byProduct.get(m.productId) ?? { in: 0, out: 0, adjust: 0 };
      if (m.type === 'IN') agg.in += m.qty;
      else if (m.type === 'OUT') agg.out += Math.abs(m.qty);
      else agg.adjust += m.qty;
      byProduct.set(m.productId, agg);
    }

    const brandPriority = (brand: string) => {
      const u = brand.toUpperCase();
      if (u.includes('MICHELIN')) return 0;
      if (u.includes('BFGOODRICH') || u.includes('BF')) return 1;
      return 2;
    };

    // Build in/out/adjust product lists
    const inList: any[] = [];
    const outList: any[] = [];
    const adjustList: any[] = [];
    for (const [productId, agg] of byProduct) {
      const p = productMap.get(productId);
      if (!p) continue;
      const base = { productId, brand: p.brand, model: p.model, sizeNormalized: p.sizeNormalized, sizeRim: p.sizeRim ?? 0 };
      if (agg.in > 0) inList.push({ ...base, qty: agg.in });
      if (agg.out > 0) outList.push({ ...base, qty: agg.out });
      if (agg.adjust !== 0) adjustList.push({ ...base, qty: agg.adjust });
    }
    const sortProducts = (arr: any[]) => arr.sort((a, b) => brandPriority(a.brand) - brandPriority(b.brand) || a.sizeRim - b.sizeRim);

    // Sales summary for the day
    const sales = await this.prisma.sale.findMany({
      where: { shopId, createdAt: { gte: start, lte: end } },
      select: { totalAmount: true, paymentMethod: true },
    });

    const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
    const tiresOut = [...byProduct.values()].reduce((s, x) => s + x.out, 0);
    const tiresIn = [...byProduct.values()].reduce((s, x) => s + x.in, 0);
    const adjustCount = adjustList.reduce((s: number, m: any) => s + Math.abs(m.qty), 0);

    return {
      date,
      summary: { tiresOut, tiresIn, adjustCount, totalRevenue, salesCount: sales.length },
      byType: {
        in: sortProducts(inList),
        out: sortProducts(outList),
        adjust: sortProducts(adjustList),
      },
      movements: movements.map((m) => {
        const p = productMap.get(m.productId);
        return { id: m.id, type: m.type, qty: m.qty, note: m.note, createdAt: m.createdAt, brand: p?.brand ?? '', model: p?.model ?? '', sizeNormalized: p?.sizeNormalized ?? '' };
      }),
    };
  }

  async saveSnapshot(
    snapshotId: string,
    shopId: string,
    entries: { entryId: string; qtyActual: number }[],
  ) {
    const snapshot = await this.prisma.stockSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (!snapshot || snapshot.shopId !== shopId) {
      throw new NotFoundException('Snapshot not found');
    }

    await Promise.all(
      entries.map((e) =>
        this.prisma.stockSnapshotEntry.update({
          where: { id: e.entryId },
          data: { qtyActual: e.qtyActual },
        }),
      ),
    );

    return this.prisma.stockSnapshot.findUnique({
      where: { id: snapshotId },
      include: { entries: true },
    });
  }
}

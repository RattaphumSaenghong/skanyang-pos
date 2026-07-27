import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

interface UpdateQuotationDto {
  plateNumber?: string;
  notes?: string;
  status?: string;
  sizeNote?: string;
  promoNote?: string;
}

@Injectable()
export class QuotationsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateQuotationDto, userId: string, shopId: string | null) {
    // OWNER has shopId=null — fall back to first shop that has an active price list
    let effectiveShopId = shopId;
    let activePL;
    if (effectiveShopId) {
      activePL = await this.prisma.priceList.findFirst({ where: { shopId: effectiveShopId, isActive: true } });
    } else {
      activePL = await this.prisma.priceList.findFirst({ where: { isActive: true } });
      if (activePL) effectiveShopId = activePL.shopId;
    }
    if (!activePL || !effectiveShopId) throw new ForbiddenException('No active price list');

    const entries = await this.prisma.priceEntry.findMany({
      where: { id: { in: dto.items.map((i) => i.priceEntryId) } },
      include: { product: true },
    });

    const quotation = await this.prisma.quotation.create({
      data: {
        shopId: effectiveShopId,
        priceListId: activePL.id,
        createdById: userId,
        customerId: dto.customerId ?? null,
        plateNumber: dto.plateNumber ?? null,
        notes: dto.notes ?? null,
        items: {
          create: dto.items.map((item) => {
            const entry = entries.find((e) => e.id === item.priceEntryId)!;
            return {
              productId: entry.productId,
              priceEntryId: item.priceEntryId,
              qty: item.qty,
              isSetPricing: entry.product.isSetPricing,
              isNonPromo: entry.product.isNonPromo,
              isIndividual: item.isIndividual ?? false,
              unitPriceCash: entry.priceCash,
              unitPriceCard: entry.priceCard,
              unitPriceZeroPct: entry.priceZeroPct,
              priceListed: entry.priceListed,
              discTradeIn: entry.discTradeIn,
              discCard: entry.discCard,
              discCash: entry.discCash,
              discPromo: entry.discPromo,
            };
          }),
        },
      },
      include: { items: { include: { product: true } } },
    });

    return quotation;
  }

  async findOne(id: string, shopId?: string | null, role?: string) {
    const q = await this.prisma.quotation.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        customer: true,
      },
    });
    if (!q) throw new NotFoundException('Quotation not found');
    if (role !== 'OWNER' && shopId && q.shopId !== shopId) throw new ForbiddenException('Access denied');
    // Prices live on the item itself — no PriceEntry lookup, so a re-imported
    // price list can no longer blank out an existing quotation
    return q;
  }

  async update(id: string, dto: UpdateQuotationDto, shopId?: string | null, role?: string) {
    if (role !== 'OWNER' && shopId) {
      const q = await this.prisma.quotation.findUnique({ where: { id }, select: { shopId: true } });
      if (q && q.shopId !== shopId) throw new ForbiddenException('Access denied');
    }
    return this.prisma.quotation.update({ where: { id }, data: dto as any });
  }

  async cancel(id: string, shopId?: string | null, role?: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (role !== 'OWNER' && shopId && quotation.shopId !== shopId) throw new ForbiddenException('Access denied');
    if (quotation.status === 'CONVERTED') throw new BadRequestException('ไม่สามารถยกเลิกใบเสนอราคาที่แปลงเป็นการขายแล้ว');

    // Clear from display if it was active
    await this.prisma.shop.updateMany({
      where: { id: quotation.shopId, activeDisplayQuotationId: id },
      data: { activeDisplayQuotationId: null },
    });

    return this.prisma.quotation.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  async updateItem(quotationId: string, itemId: string, dto: { qty?: number; isIndividual?: boolean }) {
    const item = await this.prisma.quotationItem.findUnique({ where: { id: itemId } });
    if (!item || item.quotationId !== quotationId) throw new NotFoundException('Item not found');
    const data: { qty?: number; isIndividual?: boolean } = {};
    if (dto.qty !== undefined) data.qty = dto.qty;
    if (dto.isIndividual !== undefined) data.isIndividual = dto.isIndividual;
    const updated = await this.prisma.quotationItem.update({ where: { id: itemId }, data });
    // Editing an item is activity on the quotation, but writing to QuotationItem
    // does not touch Quotation.updatedAt — bump it so the stale-draft cleanup
    // does not cancel a quote that is actively being worked on
    await this.prisma.quotation.update({ where: { id: quotationId }, data: {} });
    return updated;
  }

  findByShop(shopId: string) {
    return this.prisma.quotation.findMany({
      where: { shopId },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Cron('* * * * *') // every minute
  async cleanupAllStaleDrafts() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const stale = await this.prisma.quotation.findMany({
      where: { status: 'DRAFT', updatedAt: { lt: cutoff } },
      select: { id: true, shopId: true },
    });
    if (stale.length === 0) return;
    const ids = stale.map((q) => q.id);
    const shopIds = [...new Set(stale.map((q) => q.shopId))];
    await Promise.all(shopIds.map((sid) =>
      this.prisma.shop.updateMany({
        where: { id: sid, activeDisplayQuotationId: { in: ids } },
        data: { activeDisplayQuotationId: null },
      })
    ));
    await this.prisma.quotation.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED' } });
  }

  async cleanupStaleDrafts(shopId: string) {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
    const stale = await this.prisma.quotation.findMany({
      where: { shopId, status: 'DRAFT', updatedAt: { lt: cutoff } },
      select: { id: true },
    });
    if (stale.length === 0) return { cancelled: 0 };

    const ids = stale.map((q) => q.id);
    await this.prisma.shop.updateMany({
      where: { id: shopId, activeDisplayQuotationId: { in: ids } },
      data: { activeDisplayQuotationId: null },
    });
    await this.prisma.quotation.updateMany({
      where: { id: { in: ids } },
      data: { status: 'CANCELLED' },
    });
    return { cancelled: stale.length };
  }

  report(shopId: string | null, dateFrom?: string, dateTo?: string) {
    const where: any = {};
    if (shopId) where.shopId = shopId;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    return this.prisma.quotation.findMany({
      where,
      select: {
        id: true,
        number: true,
        createdAt: true,
        status: true,
        plateNumber: true,
        shopId: true,
        items: {
          select: {
            qty: true,
            product: { select: { sizeNormalized: true, brand: true, model: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}

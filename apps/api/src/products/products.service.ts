import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async search(q: string, role: 'OWNER' | 'STAFF', shopId?: string | null) {
    if (!shopId) return [];
    const activePriceList = await this.prisma.priceList.findFirst({ where: { shopId, isActive: true } });
    if (!activePriceList) return [];

    const entries = await this.prisma.priceEntry.findMany({
      where: {
        priceListId: activePriceList.id,
        product: {
          active: true,
          OR: [
            { sizeNormalized: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
            { sizeRaw: { contains: q, mode: 'insensitive' } },
          ],
        },
      },
      include: { product: true },
      orderBy: { product: { sortOrder: 'asc' } },
      take: 50,
    });

    const productIds = entries.map((e) => e.productId);
    const stockItems = await this.prisma.stockItem.findMany({
      where: { shopId, productId: { in: productIds } },
      select: { productId: true, qtyOnHand: true, qtyReserved: true },
    });
    const stockMap = new Map(stockItems.map((s) => [s.productId, s]));

    return entries.map((entry) => {
      const stock = stockMap.get(entry.productId);
      const qtyOnHand = stock?.qtyOnHand ?? 0;
      const qtyAvailable = qtyOnHand;

      const staffShape = {
        id: entry.id,
        productId: entry.productId,
        product: {
          sku: entry.product.sku,
          brand: entry.product.brand,
          model: entry.product.model,
          sizeNormalized: entry.product.sizeNormalized,
          isSetPricing: entry.product.isSetPricing,
          dotYear: entry.product.dotYear,
        },
        priceListed: entry.priceListed,
        priceCash: entry.priceCash,
        priceCard: entry.priceCard,
        priceZeroPct: entry.priceZeroPct,
        priceBulk: entry.priceBulk,
        discTradeIn: entry.discTradeIn,
        discCard: entry.discCard,
        discCash: entry.discCash,
        discPromo: entry.discPromo,
        qtyOnHand,
        qtyAvailable,
      };

      if (role !== 'OWNER') return staffShape;

      return { ...staffShape, costNormal: entry.costNormal, costPromo: entry.costPromo, marginCash: entry.marginCash };
    });
  }

  findAll() {
    return this.prisma.product.findMany({ where: { active: true }, orderBy: { sizeNormalized: 'asc' } });
  }
}

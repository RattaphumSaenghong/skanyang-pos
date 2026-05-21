import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async margins(shopId: string) {
    const items = await this.prisma.saleItem.findMany({
      where: { sale: { shopId } },
      include: { product: true, sale: { select: { createdAt: true, paymentMethod: true } } },
    });

    const map = new Map<string, any>();
    for (const item of items) {
      const key = item.productId;
      const existing = map.get(key) ?? {
        productId: key,
        brand: item.product.brand,
        model: item.product.model,
        sizeNormalized: item.product.sizeNormalized,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        unitsSold: 0,
      };
      existing.totalRevenue += item.subtotal;
      existing.totalCost += item.unitCost * item.qty;
      existing.totalProfit += item.profit;
      existing.unitsSold += item.qty;
      map.set(key, existing);
    }

    return Array.from(map.values())
      .map((r) => ({ ...r, marginPct: r.totalRevenue > 0 ? r.totalProfit / r.totalRevenue : 0 }))
      .sort((a, b) => b.totalProfit - a.totalProfit);
  }

  async topSellers(shopId: string) {
    const items = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { shopId } },
      _sum: { qty: true, subtotal: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: 20,
    });

    return Promise.all(
      items.map(async (i) => {
        const product = await this.prisma.product.findUnique({ where: { id: i.productId } });
        return { ...product, unitsSold: i._sum.qty, revenue: i._sum.subtotal };
      }),
    );
  }
}

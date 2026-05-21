import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  async checkout(quotationId: string, paymentMethod: PaymentMethod, userId: string, shopId: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { items: { include: { product: true } } },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const unitPrice = (item: any) =>
      paymentMethod === 'CARD' ? item.unitPriceCard
      : paymentMethod === 'ZERO_PCT' ? item.unitPriceZeroPct
      : item.unitPriceCash;

    const saleItems = await Promise.all(
      quotation.items.map(async (item) => {
        const priceEntry = await this.prisma.priceEntry.findFirst({
          where: { id: item.priceEntryId },
        });
        const cost = priceEntry ? (priceEntry.costPromo ?? priceEntry.costNormal) : 0;
        const price = unitPrice(item);
        return {
          productId: item.productId,
          qty: item.qty,
          unitCost: cost,
          unitPrice: price,
          subtotal: price * item.qty,
          profit: (price - cost) * item.qty,
        };
      }),
    );

    const totalAmount = saleItems.reduce((s, i) => s + i.subtotal, 0);
    const totalCost = saleItems.reduce((s, i) => s + i.unitCost * i.qty, 0);
    const grossProfit = totalAmount - totalCost;

    const sale = await this.prisma.sale.create({
      data: {
        shopId: quotation.shopId,
        quotationId,
        customerId: quotation.customerId,
        paymentMethod,
        totalAmount,
        totalCost,
        grossProfit,
        servedById: userId,
        items: { create: saleItems },
      },
      include: { items: true },
    });

    // Deduct stock and release reservation
    for (const item of saleItems) {
      await this.prisma.stockItem.updateMany({
        where: { shopId: quotation.shopId, productId: item.productId },
        data: {
          qtyOnHand: { decrement: item.qty },
          qtyReserved: { decrement: item.qty },
        },
      });
      await this.prisma.stockMovement.create({
        data: {
          shopId: quotation.shopId,
          productId: item.productId,
          type: 'OUT',
          qty: -item.qty,
          referenceId: sale.id,
          createdBy: userId,
        },
      });
    }

    await this.prisma.quotation.update({
      where: { id: quotationId },
      data: { status: 'CONVERTED' },
    });

    return sale;
  }

  findByShop(shopId: string) {
    return this.prisma.sale.findMany({
      where: { shopId },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

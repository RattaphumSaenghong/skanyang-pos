import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

    const isBelowCost = saleItems.some(i => i.unitPrice < i.unitCost);
    const flag = isBelowCost ? 'BELOW_COST' : 'NORMAL';

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
        flag,
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

  async approve(id: string, approverId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id } });
    if (!sale) throw new NotFoundException('Sale not found');
    if (sale.flag !== 'BELOW_COST') throw new BadRequestException('Sale is not flagged as below cost');
    return this.prisma.sale.update({
      where: { id },
      data: { flag: 'APPROVED', flagApprovedBy: approverId, flagApprovedAt: new Date() },
    });
  }

  async createManual(dto: { productId: string; qty: number; unitPrice: number; paymentMethod: PaymentMethod; note?: string; shopId: string }, userId: string) {
    const priceEntry = await this.prisma.priceEntry.findFirst({
      where: { productId: dto.productId, priceList: { isActive: true } },
    });
    const cost = priceEntry ? (priceEntry.costPromo ?? priceEntry.costNormal) : 0;

    const subtotal = dto.unitPrice * dto.qty;
    const profit = (dto.unitPrice - cost) * dto.qty;

    const sale = await this.prisma.sale.create({
      data: {
        shopId: dto.shopId,
        paymentMethod: dto.paymentMethod,
        totalAmount: subtotal,
        totalCost: cost * dto.qty,
        grossProfit: profit,
        flag: 'SPECIAL',
        servedById: userId,
        items: {
          create: [{
            productId: dto.productId,
            qty: dto.qty,
            unitCost: cost,
            unitPrice: dto.unitPrice,
            subtotal,
            profit,
          }],
        },
      },
      include: { items: true },
    });

    await this.prisma.stockItem.updateMany({
      where: { shopId: dto.shopId, productId: dto.productId },
      data: { qtyOnHand: { decrement: dto.qty } },
    });

    await this.prisma.stockMovement.create({
      data: {
        shopId: dto.shopId,
        productId: dto.productId,
        type: 'OUT',
        qty: -dto.qty,
        referenceId: sale.id,
        note: dto.note,
        createdBy: userId,
      },
    });

    return sale;
  }

  findByShop(shopId: string) {
    return this.prisma.sale.findMany({
      where: { shopId },
      include: {
        items: { include: { product: true } },
        servedBy: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

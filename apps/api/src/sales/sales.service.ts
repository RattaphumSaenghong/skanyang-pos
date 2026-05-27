import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { QuotationEmailService } from '../quotations/quotation-email.service';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private emailService: QuotationEmailService,
  ) {}

  async checkout(quotationId: string, paymentMethod: PaymentMethod, userId: string, customerEmail?: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { items: { include: { product: true } } },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === 'CONVERTED') throw new BadRequestException('Quotation already converted');

    const unitPrice = (item: any) =>
      paymentMethod === 'CARD' ? item.unitPriceCard
      : paymentMethod === 'ZERO_PCT' ? item.unitPriceZeroPct
      : item.unitPriceCash;

    // Check all items have sufficient stock before decrementing any
    for (const item of quotation.items) {
      const stock = await this.prisma.stockItem.findUnique({
        where: { shopId_productId: { shopId: quotation.shopId, productId: item.productId } },
      });
      if ((stock?.qtyOnHand ?? 0) < item.qty) {
        throw new BadRequestException(
          `สต็อกไม่เพียงพอสำหรับ productId ${item.productId} (มี ${stock?.qtyOnHand ?? 0} ชิ้น ต้องการ ${item.qty})`,
        );
      }
    }

    // All checks passed — decrement stock for each item
    for (const item of quotation.items) {
      await this.prisma.stockItem.update({
        where: { shopId_productId: { shopId: quotation.shopId, productId: item.productId } },
        data: { qtyOnHand: { decrement: item.qty } },
      });
    }

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

    // Log stock movements (stock already decremented atomically during the check above)
    for (const item of saleItems) {
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

    // Clear from customer display
    await this.prisma.shop.updateMany({
      where: { id: quotation.shopId, activeDisplayQuotationId: quotationId },
      data: { activeDisplayQuotationId: null },
    });

    if (customerEmail) {
      try {
        const shop = await this.prisma.shop.findUnique({ where: { id: quotation.shopId } });
        await this.emailService.send(quotation, shop, customerEmail);
      } catch {
        // Email failure is non-fatal — sale is already committed
      }
    }

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
    // Atomic stock check + decrement before creating the sale
    const stockResult = await this.prisma.stockItem.updateMany({
      where: { shopId: dto.shopId, productId: dto.productId, qtyOnHand: { gte: dto.qty } },
      data: { qtyOnHand: { decrement: dto.qty } },
    });
    if (stockResult.count === 0) {
      const stock = await this.prisma.stockItem.findUnique({
        where: { shopId_productId: { shopId: dto.shopId, productId: dto.productId } },
      });
      throw new BadRequestException(`สต็อกไม่เพียงพอ (มี ${stock?.qtyOnHand ?? 0} ชิ้น)`);
    }

    const priceEntry = await this.prisma.priceEntry.findFirst({
      where: { productId: dto.productId, priceList: { shopId: dto.shopId, isActive: true } },
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

  findByShop(shopId: string | null, dateFrom?: Date, dateTo?: Date) {
    return this.prisma.sale.findMany({
      where: {
        ...(shopId ? { shopId } : {}),
        ...(dateFrom || dateTo
          ? { createdAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } }
          : {}),
      },
      include: {
        items: { include: { product: { select: { sku: true, sizeNormalized: true } } } },
        servedBy: { select: { username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}

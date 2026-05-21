import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
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

  async create(dto: CreateQuotationDto, userId: string, shopId: string) {
    const activePL = await this.prisma.priceList.findFirst({ where: { isActive: true } });
    if (!activePL) throw new ForbiddenException('No active price list');

    const entries = await this.prisma.priceEntry.findMany({
      where: { id: { in: dto.items.map((i) => i.priceEntryId) } },
      include: { product: true },
    });

    const quotation = await this.prisma.quotation.create({
      data: {
        shopId,
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
              unitPriceCash: entry.priceCash,
              unitPriceCard: entry.priceCard,
              unitPriceZeroPct: entry.priceZeroPct,
            };
          }),
        },
      },
      include: { items: { include: { product: true } } },
    });

    // Reserve stock
    for (const item of dto.items) {
      const entry = entries.find((e) => e.id === item.priceEntryId)!;
      await this.prisma.stockItem.upsert({
        where: { shopId_productId: { shopId, productId: entry.productId } },
        create: { shopId, productId: entry.productId, qtyReserved: item.qty },
        update: { qtyReserved: { increment: item.qty } },
      });
    }

    return quotation;
  }

  async findOne(id: string) {
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
    // Enrich each item with its priceEntry discount fields
    const enrichedItems = await Promise.all(
      q.items.map(async (item) => {
        const pe = await this.prisma.priceEntry.findUnique({ where: { id: item.priceEntryId } });
        return {
          ...item,
          priceListed: pe?.priceListed ?? 0,
          discTradeIn: pe?.discTradeIn ?? 0,
          discCard: pe?.discCard ?? 0,
          discCash: pe?.discCash ?? 0,
          discPromo: pe?.discPromo ?? 0,
        };
      }),
    );
    return { ...q, items: enrichedItems };
  }

  async update(id: string, dto: UpdateQuotationDto) {
    return this.prisma.quotation.update({ where: { id }, data: dto as any });
  }

  findByShop(shopId: string) {
    return this.prisma.quotation.findMany({
      where: { shopId },
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

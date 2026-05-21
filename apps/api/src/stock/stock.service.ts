import { Injectable, BadRequestException } from '@nestjs/common';
import { MovementType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  findByShop(shopId: string | null) {
    return this.prisma.stockItem.findMany({
      where: shopId ? { shopId } : undefined,
      include: { product: true, shop: { select: { id: true, name: true } } },
      orderBy: { product: { sizeNormalized: 'asc' } },
    });
  }

  async adjust(shopId: string, productId: string, qty: number, note: string, userId: string) {
    if (qty < 0) {
      const current = await this.prisma.stockItem.findUnique({
        where: { shopId_productId: { shopId, productId } },
      });
      const currentQty = current?.qtyOnHand ?? 0;
      if (currentQty + qty < 0) {
        throw new BadRequestException(`สต็อกไม่เพียงพอ (มี ${currentQty} ชิ้น)`);
      }
    }
    const item = await this.prisma.stockItem.upsert({
      where: { shopId_productId: { shopId, productId } },
      create: { shopId, productId, qtyOnHand: Math.max(0, qty) },
      update: { qtyOnHand: { increment: qty } },
    });
    await this.prisma.stockMovement.create({
      data: { shopId, productId, type: MovementType.ADJUST, qty, note, createdBy: userId },
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
}

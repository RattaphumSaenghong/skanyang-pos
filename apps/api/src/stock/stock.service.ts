import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
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

  getSnapshots(shopId: string) {
    return this.prisma.stockSnapshot.findMany({
      where: { shopId, archived: false },
      include: { entries: true },
      orderBy: { takenAt: 'desc' },
      take: 6,
    });
  }

  async takeSnapshot(shopId: string, takenBy: string, label?: string) {
    const stockItems = await this.prisma.stockItem.findMany({
      where: { shopId },
      include: { product: true },
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

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async search(q: string, shopId?: string | null) {
    const activePriceList = await this.prisma.priceList.findFirst({ where: { isActive: true } });
    if (!activePriceList) return [];

    return this.prisma.priceEntry.findMany({
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
      take: 50,
    });
  }

  findAll() {
    return this.prisma.product.findMany({ where: { active: true }, orderBy: { sizeNormalized: 'asc' } });
  }
}

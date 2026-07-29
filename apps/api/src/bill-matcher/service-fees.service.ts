import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateServiceFeeDto } from './dto/create-service-fee.dto';
import { UpdateServiceFeeDto } from './dto/update-service-fee.dto';

const DEFAULT_SERVICE_FEES = [
  {
    name: 'ปะยาง',
    minPrice: 100,
    maxPrice: 200,
    maxQty: 4,
    group: 'patch',
    sortOrder: 1,
  },
  {
    name: 'ตั้งศูนย์',
    minPrice: 150,
    maxPrice: 300,
    maxQty: 1,
    group: 'wheel',
    sortOrder: 2,
  },
  {
    name: 'สลับยางถ่วงล้อ',
    minPrice: 100,
    maxPrice: 250,
    maxQty: 1,
    group: 'wheel',
    sortOrder: 3,
  },
  {
    name: 'สลับยางถ่วงล้อ + ตั้งศูนย์',
    minPrice: 250,
    maxPrice: 400,
    maxQty: 1,
    group: 'wheel',
    sortOrder: 4,
  },
  {
    name: 'เจียจานเบรก',
    minPrice: 250,
    maxPrice: 250,
    maxQty: 4,
    group: 'brake',
    sortOrder: 5,
  },
  {
    name: 'ถ่วงล้อ',
    minPrice: 100,
    maxPrice: 200,
    maxQty: 1,
    group: 'wheel',
    sortOrder: 6,
  },
];

@Injectable()
export class ServiceFeesService {
  constructor(private prisma: PrismaService) {}

  async findAll(shopId: string) {
    let fees = await this.prisma.serviceFee.findMany({
      where: { shopId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // Seed defaults only for a brand-new shop. If the owner intentionally
    // disabled every fee, matching should respect that choice.
    if (
      fees.length === 0 &&
      (await this.prisma.serviceFee.count({ where: { shopId } })) === 0
    ) {
      const created = await this.prisma.serviceFee.createMany({
        data: DEFAULT_SERVICE_FEES.map((f) => ({
          ...f,
          shopId,
        })),
      });

      if (created.count > 0) {
        fees = await this.prisma.serviceFee.findMany({
          where: { shopId, active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
      }
    }

    return fees;
  }

  async create(shopId: string, dto: CreateServiceFeeDto) {
    return await this.prisma.serviceFee.create({
      data: {
        shopId,
        name: dto.name,
        minPrice: dto.minPrice,
        maxPrice: dto.maxPrice,
        maxQty: dto.maxQty,
        group: dto.group,
        sortOrder: dto.sortOrder ?? 0,
        active: true,
      },
    });
  }

  async update(id: string, shopId: string, dto: UpdateServiceFeeDto) {
    // Ownership check
    const fee = await this.prisma.serviceFee.findFirst({
      where: { id, shopId },
    });
    if (!fee) {
      throw new NotFoundException('ไม่พบค่าบริการนี้');
    }

    return await this.prisma.serviceFee.update({
      where: { id },
      data: {
        name: dto.name,
        minPrice: dto.minPrice,
        maxPrice: dto.maxPrice,
        maxQty: dto.maxQty,
        group: dto.group,
        sortOrder: dto.sortOrder,
        active: dto.active,
      },
    });
  }

  async softDelete(id: string, shopId: string) {
    // Ownership check
    const fee = await this.prisma.serviceFee.findFirst({
      where: { id, shopId },
    });
    if (!fee) {
      throw new NotFoundException('ไม่พบค่าบริการนี้');
    }

    return await this.prisma.serviceFee.update({
      where: { id },
      data: { active: false },
    });
  }
}

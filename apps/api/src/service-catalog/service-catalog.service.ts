import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServiceCatalogService {
  constructor(private prisma: PrismaService) {}

  async create(shopId: string, dto: CreateServiceDto) {
    try {
      return await this.prisma.service.create({
        data: {
          shopId,
          name: dto.name,
          estimatedMinutes: dto.estimatedMinutes,
          requiresBay: dto.requiresBay ?? true,
          active: true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('มีบริการชื่อนี้อยู่แล้ว');
      }
      throw error;
    }
  }

  async findAll(shopId: string, includeInactive: boolean = false) {
    const where: any = { shopId };
    if (!includeInactive) {
      where.active = true;
    }
    return await this.prisma.service.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async update(id: string, shopId: string, dto: UpdateServiceDto) {
    // Ownership check
    const service = await this.prisma.service.findFirst({
      where: { id, shopId },
    });
    if (!service) {
      throw new NotFoundException('ไม่พบบริการนี้');
    }

    try {
      return await this.prisma.service.update({
        where: { id },
        data: {
          name: dto.name,
          estimatedMinutes: dto.estimatedMinutes,
          requiresBay: dto.requiresBay,
          sortOrder: dto.sortOrder,
          active: dto.active,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('มีบริการชื่อนี้อยู่แล้ว');
      }
      throw error;
    }
  }

  async softDelete(id: string, shopId: string) {
    // Ownership check
    const service = await this.prisma.service.findFirst({
      where: { id, shopId },
    });
    if (!service) {
      throw new NotFoundException('ไม่พบบริการนี้');
    }

    return await this.prisma.service.update({
      where: { id },
      data: { active: false },
    });
  }
}

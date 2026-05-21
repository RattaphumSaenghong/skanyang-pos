import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('shops')
export class ShopsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.shop.findMany({ orderBy: { name: 'asc' } });
  }
}

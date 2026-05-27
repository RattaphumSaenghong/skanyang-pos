import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

@UseGuards(JwtAuthGuard)
@Controller('shops')
export class ShopsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.shop.findMany({ orderBy: { name: 'asc' } });
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER)
  update(@Param('id') id: string, @Body() body: { name?: string; phone?: string; address?: string; email?: string }) {
    return this.prisma.shop.update({ where: { id }, data: body });
  }
}

import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Patch, UseGuards } from '@nestjs/common';
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.prisma.shop.findUnique({ where: { id } });
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER)
  update(@Param('id') id: string, @Body() body: { name?: string; phone?: string; address?: string; email?: string; promoText?: string }) {
    return this.prisma.shop.update({ where: { id }, data: body });
  }

  // IP Whitelist
  @Get(':shopId/ip-whitelist')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER)
  getIpWhitelist(@Param('shopId') shopId: string) {
    return this.prisma.ipWhitelist.findMany({ where: { shopId }, orderBy: { createdAt: 'asc' } });
  }

  @Post(':shopId/ip-whitelist')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER)
  addIp(@Param('shopId') shopId: string, @Body() body: { ipAddress: string; label?: string }) {
    return this.prisma.ipWhitelist.create({ data: { shopId, ipAddress: body.ipAddress, label: body.label } });
  }

  @Delete('ip-whitelist/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER)
  async removeIp(@Param('id') id: string) {
    const entry = await this.prisma.ipWhitelist.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('IP whitelist entry not found');
    return this.prisma.ipWhitelist.delete({ where: { id } });
  }
}

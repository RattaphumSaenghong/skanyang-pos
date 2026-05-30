import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SalesService } from './sales.service';

@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private service: SalesService) {}

  @Post()
  checkout(@Body() body: any, @CurrentUser() user: any) {
    return this.service.checkout(body.quotationId, body.paymentMethod, user.id, body.customerEmail);
  }

  @Post('manual')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OWNER)
  createManual(@Body() dto: any, @CurrentUser() user: any) {
    return this.service.createManual(dto, user.id);
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OWNER)
  approve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.approve(id, user.id);
  }

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const shopId = user.role === 'OWNER' ? null : user.shopId; // SHOP_OWNER uses their own shopId
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : undefined;
    return this.service.findByShop(shopId, from, to);
  }
}

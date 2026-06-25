import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { StockService } from './stock.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('stock')
export class StockController {
  constructor(private service: StockService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('shopId') shopId?: string) {
    // STAFF is locked to their shop; OWNER may filter or see all
    const effectiveShop = user.role === 'OWNER' ? (shopId || null) : user.shopId;
    return this.service.findByShop(effectiveShop);
  }

  @Get('movements')
  movements(@CurrentUser() user: any) {
    return this.service.movements(user.shopId);
  }

  @Get('daily-report')
  dailyReport(@CurrentUser() user: any, @Query('date') date: string, @Query('shopId') qShopId?: string) {
    const shopId = user.role === 'OWNER' && qShopId ? qShopId : user.shopId;
    const d = date ?? new Date().toISOString().slice(0, 10);
    return this.service.dailyReport(shopId, d);
  }

  @Post('adjust')
  @Roles(Role.OWNER)
  adjust(@Body() body: any, @CurrentUser() user: any) {
    // OWNER may adjust any shop; STAFF is locked to their own shop
    const shopId = user.role === 'OWNER' ? body.shopId : user.shopId;
    return this.service.adjust(shopId, body.productId, body.qty, body.note ?? '', user.id);
  }

  @Get('snapshots')
  getSnapshots(@CurrentUser() user: any, @Query('shopId') qShopId?: string) {
    const shopId = user.role === 'OWNER' && qShopId ? qShopId : user.shopId;
    return this.service.getSnapshots(shopId);
  }

  @Post('snapshots')
  takeSnapshot(@CurrentUser() user: any, @Body() body: { shopId?: string; label?: string }) {
    const shopId = user.role === 'OWNER' && body.shopId ? body.shopId : user.shopId;
    return this.service.takeSnapshot(shopId, user.username, body.label);
  }

  @Patch('snapshots/:id')
  saveSnapshot(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { shopId?: string; entries: { entryId: string; qtyActual: number }[] },
  ) {
    const shopId = user.role === 'OWNER' ? (body.shopId ?? '') : (user.shopId ?? '');
    return this.service.saveSnapshot(id, shopId, body.entries);
  }
}

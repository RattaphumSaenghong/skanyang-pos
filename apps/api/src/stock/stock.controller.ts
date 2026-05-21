import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StockService } from './stock.service';

@UseGuards(JwtAuthGuard)
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

  @Post('adjust')
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
    @Body() body: { entries: { entryId: string; qtyActual: number }[] },
  ) {
    return this.service.saveSnapshot(id, user.shopId ?? '', body.entries);
  }
}

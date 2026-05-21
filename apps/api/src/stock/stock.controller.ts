import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
}

import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProductsService } from './products.service';

@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Get('search')
  search(@Query('q') q: string, @Query('shopId') qShopId: string, @CurrentUser() user: any) {
    const role: 'OWNER' | 'STAFF' = user.role === 'OWNER' ? 'OWNER' : 'STAFF';
    const shopId = user.role === 'OWNER' ? (qShopId ?? user.shopId) : user.shopId;
    return this.products.search(q ?? '', role, shopId);
  }

  @Get()
  findAll() {
    return this.products.findAll();
  }
}

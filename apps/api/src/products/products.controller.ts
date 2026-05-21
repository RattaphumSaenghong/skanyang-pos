import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProductsService } from './products.service';

const COST_FIELDS = ['costNormal', 'costPromo', 'marginCash', 'marginBulk', 'marketArp'];

function stripCosts(entries: any[]) {
  return entries.map((e) => {
    const clean = { ...e };
    for (const f of COST_FIELDS) delete clean[f];
    return clean;
  });
}

@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Get('search')
  async search(@Query('q') q: string, @CurrentUser() user: any) {
    const results = await this.products.search(q ?? '', user.shopId);
    return user.role === 'OWNER' ? results : stripCosts(results);
  }

  @Get()
  findAll() {
    return this.products.findAll();
  }
}

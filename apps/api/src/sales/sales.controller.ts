import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SalesService } from './sales.service';

@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private service: SalesService) {}

  @Post()
  checkout(@Body() body: any, @CurrentUser() user: any) {
    return this.service.checkout(body.quotationId, body.paymentMethod, user.id, user.shopId);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.service.findByShop(user.shopId);
  }
}

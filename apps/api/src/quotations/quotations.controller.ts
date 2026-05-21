import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { QuotationsService } from './quotations.service';

@UseGuards(JwtAuthGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private service: QuotationsService) {}

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    // OWNER (shopId=null) may specify a shopId; STAFF is locked to their own shop
    const shopId = user.role === 'OWNER' ? (body.shopId ?? user.shopId) : user.shopId;
    return this.service.create(body, user.id, shopId);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.service.findByShop(user.shopId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }
}

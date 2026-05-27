import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { QuotationsService } from './quotations.service';
import { QuotationEmailService } from './quotation-email.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@UseGuards(JwtAuthGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(
    private service: QuotationsService,
    private emailService: QuotationEmailService,
    private prisma: PrismaService,
  ) {}

  @Post()
  create(@Body() body: CreateQuotationDto, @CurrentUser() user: any) {
    const shopId = user.role === 'OWNER' ? ((body as any).shopId ?? user.shopId) : user.shopId;
    return this.service.create(body, user.id, shopId);
  }

  @Get('report')
  report(@CurrentUser() user: any, @Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string, @Query('shopId') shopId?: string) {
    const effectiveShopId = user.role === 'OWNER' ? (shopId ?? null) : user.shopId;
    return this.service.report(effectiveShopId, dateFrom, dateTo);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.service.findByShop(user.shopId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.findOne(id, user.shopId, user.role);
  }

  @Patch(':id/items/:itemId')
  updateItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() body: any) {
    return this.service.updateItem(id, itemId, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.service.update(id, body, user.shopId, user.role);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.cancel(id, user.shopId, user.role);
  }

  @Post(':id/send-email')
  async sendEmail(@Param('id') id: string, @Body('email') email: string) {
    const quotation = await this.service.findOne(id);
    const shop = await this.prisma.shop.findUnique({ where: { id: quotation.shopId } });
    await this.emailService.send(quotation, shop, email);
    if (quotation.status === 'DRAFT') {
      await this.prisma.quotation.update({ where: { id }, data: { status: 'SENT' } });
    }
    return { ok: true };
  }
}

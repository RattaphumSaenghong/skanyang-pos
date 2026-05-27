import { Module } from '@nestjs/common';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationEmailService } from './quotation-email.service';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationEmailService],
  exports: [QuotationEmailService],
})
export class QuotationsModule {}

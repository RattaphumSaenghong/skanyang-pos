import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { QuotationEmailService } from './quotation-email.service';
import { PrismaModule } from '../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationEmailService],
  exports: [QuotationEmailService],
})
export class QuotationsModule {}

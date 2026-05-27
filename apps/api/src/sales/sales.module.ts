import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { QuotationsModule } from '../quotations/quotations.module';

@Module({
  imports: [QuotationsModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}

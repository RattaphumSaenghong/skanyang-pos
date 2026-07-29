import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { BillMatcherService } from './bill-matcher.service';
import { BillMatcherController } from './bill-matcher.controller';
import { ServiceFeesService } from './service-fees.service';
import { ServiceFeesController } from './service-fees.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BillMatcherController, ServiceFeesController],
  providers: [BillMatcherService, ServiceFeesService],
  exports: [BillMatcherService, ServiceFeesService],
})
export class BillMatcherModule {}

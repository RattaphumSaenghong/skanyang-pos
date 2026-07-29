import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma/prisma.module';
import { BaysService } from './bays.service';
import { BayJobsService } from './bay-jobs.service';
import { BaysController } from './bays.controller';
import { BayJobsController } from './bay-jobs.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BaysController, BayJobsController],
  providers: [BaysService, BayJobsService],
})
export class BaysModule {}

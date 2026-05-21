import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PriceListsController } from './price-lists.controller';
import { PriceListsService } from './price-lists.service';

@Module({
  imports: [MulterModule.register({ storage: undefined })], // memory storage
  controllers: [PriceListsController],
  providers: [PriceListsService],
})
export class PriceListsModule {}

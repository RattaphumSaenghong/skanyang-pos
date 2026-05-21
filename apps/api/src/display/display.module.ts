import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DisplayController } from './display.controller';
import { DisplayService } from './display.service';

@Module({
  imports: [MulterModule.register({ storage: undefined })], // memory storage
  controllers: [DisplayController],
  providers: [DisplayService],
})
export class DisplayModule {}

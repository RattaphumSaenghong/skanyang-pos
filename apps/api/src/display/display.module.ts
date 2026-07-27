import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { DisplayController } from './display.controller';
import { DisplayService } from './display.service';
import { DisplayAccessGuard } from './guards/display-access.guard';

@Module({
  imports: [MulterModule.register({ storage: undefined })], // memory storage
  controllers: [DisplayController],
  providers: [DisplayService, DisplayAccessGuard],
})
export class DisplayModule {}

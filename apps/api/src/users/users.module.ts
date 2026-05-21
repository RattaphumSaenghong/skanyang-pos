import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { ShopsController } from './shops.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController, ShopsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

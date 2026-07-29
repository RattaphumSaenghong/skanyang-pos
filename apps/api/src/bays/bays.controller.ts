import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { resolveShopId } from '../common/shop-scope';
import { BaysService } from './bays.service';
import { CreateBayDto } from './dto/create-bay.dto';
import { UpdateBayDto } from './dto/update-bay.dto';

// No `GET /bays/:id` route here — it would shadow `/bays/board`.
@Controller('bays')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BaysController {
  constructor(private bays: BaysService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('shopId') shopId?: string) {
    return this.bays.findAll(resolveShopId(user, shopId));
  }

  @Get('board')
  getBoard(@CurrentUser() user: any, @Query('shopId') shopId?: string) {
    return this.bays.getBoard(resolveShopId(user, shopId));
  }

  @Post()
  @Roles(Role.OWNER)
  create(@Body() body: CreateBayDto, @CurrentUser() user: any) {
    return this.bays.create(body, resolveShopId(user, body.shopId));
  }

  @Patch(':id')
  @Roles(Role.OWNER)
  update(
    @Param('id') id: string,
    @Body() body: UpdateBayDto,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bays.update(id, body, resolveShopId(user, shopId));
  }

  @Delete(':id')
  @Roles(Role.OWNER)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bays.delete(id, resolveShopId(user, shopId));
  }
}

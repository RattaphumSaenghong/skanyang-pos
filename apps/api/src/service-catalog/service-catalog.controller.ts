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
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { resolveShopId } from '../common/shop-scope';
import { ServiceCatalogService } from './service-catalog.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Controller('service-catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServiceCatalogController {
  constructor(private service: ServiceCatalogService) {}

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.service.findAll(resolveShopId(user, shopId), includeInactive === 'true');
  }

  @Post()
  @Roles(Role.OWNER)
  create(@CurrentUser() user: any, @Body() dto: CreateServiceDto) {
    return this.service.create(resolveShopId(user, dto.shopId), dto);
  }

  @Patch(':id')
  @Roles(Role.OWNER)
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateServiceDto,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.update(id, resolveShopId(user, shopId), dto);
  }

  @Delete(':id')
  @Roles(Role.OWNER)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.softDelete(id, resolveShopId(user, shopId));
  }
}

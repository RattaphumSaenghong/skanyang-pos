import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get('ip-whitelist')
  @Roles(Role.OWNER)
  listIpWhitelist(@CurrentUser() user: any) {
    return this.settings.listIpWhitelist(user.shopId);
  }

  @Post('ip-whitelist')
  @Roles(Role.OWNER)
  addIpWhitelist(
    @CurrentUser() user: any,
    @Body() body: { ipAddress: string; label?: string },
  ) {
    return this.settings.addIpWhitelist(user.shopId, body.ipAddress, body.label);
  }

  @Delete('ip-whitelist/:id')
  @Roles(Role.OWNER)
  removeIpWhitelist(@Param('id') id: string, @CurrentUser() user: any) {
    return this.settings.removeIpWhitelist(id, user.shopId);
  }

  @Get('audit-log')
  @Roles(Role.OWNER)
  listAuditLog(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.settings.listAuditLog(Number(page), Number(limit));
  }
}

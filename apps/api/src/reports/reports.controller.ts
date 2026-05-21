import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('margins')
  margins(@CurrentUser() user: any) {
    return this.service.margins(user.shopId);
  }

  @Get('top-sellers')
  topSellers(@CurrentUser() user: any) {
    return this.service.topSellers(user.shopId);
  }
}

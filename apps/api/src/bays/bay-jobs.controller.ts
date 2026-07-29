import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { resolveShopId } from '../common/shop-scope';
import { BayJobsService } from './bay-jobs.service';
import { CreateBayJobDto } from './dto/create-bay-job.dto';
import { UpdateBayJobDto } from './dto/update-bay-job.dto';
import { shopDateString } from './tz';

// No `GET /bay-jobs/:id` route here — it would shadow `/bay-jobs/bookings`.
@Controller('bay-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BayJobsController {
  constructor(private bayJobs: BayJobsService) {}

  @Post()
  create(@Body() body: CreateBayJobDto, @CurrentUser() user: any) {
    return this.bayJobs.create(body, user.id, resolveShopId(user, body.shopId));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateBayJobDto,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.update(id, body, resolveShopId(user, shopId));
  }

  @Post(':id/check-in')
  checkIn(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.checkIn(id, resolveShopId(user, shopId));
  }

  @Post(':id/assign')
  assign(
    @Param('id') id: string,
    @Body() body: { bayId: string },
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.assign(id, body.bayId, resolveShopId(user, shopId));
  }

  @Post(':id/complete')
  complete(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.complete(id, resolveShopId(user, shopId));
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() body: { noShow?: boolean },
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.cancel(id, resolveShopId(user, shopId), body.noShow);
  }

  @Get('bookings')
  getBookings(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.getBookingsByDate(
      date || shopDateString(new Date()),
      resolveShopId(user, shopId),
    );
  }

  @Get('report')
  getReport(
    @CurrentUser() user: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('bayId') bayId?: string,
    @Query('shopId') shopId?: string,
  ) {
    return this.bayJobs.getJobsReport(
      resolveShopId(user, shopId),
      dateFrom,
      dateTo,
      bayId,
    );
  }
}

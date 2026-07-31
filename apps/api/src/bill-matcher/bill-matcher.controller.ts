import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { resolveShopId } from '../common/shop-scope';
import { BillMatcherService } from './bill-matcher.service';
import { CloseGapDto } from './dto/close-gap.dto';
import { ImportBillBatchDto } from './dto/import-bill-batch.dto';
import { MatchRequestDto } from './dto/match-request.dto';
import { RefreshStockDto } from './dto/refresh-stock.dto';
import { UpdateBillDto } from './dto/update-bill.dto';

@Controller('bill-batches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillMatcherController {
  constructor(private service: BillMatcherService) {}

  @Post('sheets')
  @Roles(Role.OWNER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.xlsx?$/i.test(file.originalname) &&
          [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream',
          ].includes(file.mimetype);
        cb(ok ? null : new Error('Only .xls / .xlsx files are accepted'), ok);
      },
    }),
  )
  async listSheets(@UploadedFile() file: Express.Multer.File) {
    const sheetNames = await this.service.listSheetNames(file.buffer);
    return { sheetNames };
  }

  /**
   * Bills and stock usually arrive as two separate workbooks, so both are
   * accepted as their own upload. Sending only `billFile` keeps the original
   * one-workbook-two-sheets flow working.
   */
  @Post('import')
  @Roles(Role.OWNER)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'billFile', maxCount: 1 },
        { name: 'itemFile', maxCount: 1 },
      ],
      {
        limits: { fileSize: 10 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          const ok =
            /\.xlsx?$/i.test(file.originalname) &&
            [
              'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/octet-stream',
            ].includes(file.mimetype);
          cb(ok ? null : new Error('Only .xls / .xlsx files are accepted'), ok);
        },
      },
    ),
  )
  async importBatch(
    @UploadedFiles()
    files: {
      billFile?: Express.Multer.File[];
      itemFile?: Express.Multer.File[];
    },
    @Body() dto: ImportBillBatchDto,
    @CurrentUser() user: any,
  ) {
    const billFile = files?.billFile?.[0];
    if (!billFile) throw new BadRequestException('กรุณาเลือกไฟล์บิล');
    const itemFile = files?.itemFile?.[0] ?? billFile;

    const shopId = resolveShopId(user, dto.shopId);
    return await this.service.importBatch(
      billFile.buffer,
      itemFile.buffer,
      dto,
      shopId,
    );
  }

  /**
   * Re-read ขายรวม into an existing batch. The column is filled in after month
   * end, long after the bills are worked, and re-importing would mean deleting
   * the batch and every hand-matched bill with it.
   */
  @Post(':id/stock')
  @Roles(Role.OWNER)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok =
          /\.xlsx?$/i.test(file.originalname) &&
          [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream',
          ].includes(file.mimetype);
        cb(ok ? null : new Error('Only .xls / .xlsx files are accepted'), ok);
      },
    }),
  )
  refreshStock(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: RefreshStockDto,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    if (!file) throw new BadRequestException('กรุณาเลือกไฟล์สต็อก');
    return this.service.refreshSoldQuantities(
      id,
      resolveShopId(user, shopId),
      file.buffer,
      dto.sheet,
    );
  }

  @Get()
  findAll(@CurrentUser() user: any, @Query('shopId') shopId?: string) {
    return this.service.findAllBatches(resolveShopId(user, shopId));
  }

  @Get(':id')
  findById(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.findBatchById(id, resolveShopId(user, shopId));
  }

  @Post(':id/match')
  @Roles(Role.OWNER)
  match(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: MatchRequestDto,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.matchBatch(id, resolveShopId(user, shopId), dto);
  }

  /** The engine's shortlist for one bill — auto-match as an assistant. */
  @Get(':id/bills/:billId/suggestions')
  @Roles(Role.OWNER)
  suggestions(
    @Param('id') id: string,
    @Param('billId') billId: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number(limit) : undefined;
    return this.service.suggestForBill(
      id,
      billId,
      resolveShopId(user, shopId),
      parsed && parsed > 0 ? parsed : undefined,
    );
  }

  /** Service lines that close whatever the operator's draft leaves short. */
  @Post(':id/bills/:billId/close-gap')
  @Roles(Role.OWNER)
  closeGap(
    @Param('id') id: string,
    @Param('billId') billId: string,
    @CurrentUser() user: any,
    @Body() dto: CloseGapDto,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.closeGapForBill(
      id,
      billId,
      resolveShopId(user, shopId),
      dto,
    );
  }

  @Patch(':id/bills/:billId')
  @Roles(Role.OWNER)
  updateBill(
    @Param('id') id: string,
    @Param('billId') billId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateBillDto,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.updateBill(
      id,
      billId,
      resolveShopId(user, shopId),
      dto,
    );
  }

  @Delete(':id')
  @Roles(Role.OWNER)
  delete(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('shopId') shopId?: string,
  ) {
    return this.service.deleteBatch(id, resolveShopId(user, shopId));
  }
}

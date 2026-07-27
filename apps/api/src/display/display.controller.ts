import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param,
  Post, UploadedFile, UseGuards, UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DisplayAccessGuard } from './guards/display-access.guard';
import { DisplayService } from './display.service';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// The customer display has no login, so the routes it calls authenticate with the
// shop's display token (?t=...). DisplayAccessGuard also accepts a normal JWT, so
// the admin banner UI can keep using GET :shopId/images.
@Controller('display')
export class DisplayController {
  constructor(private service: DisplayService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  uploadImage(
    @Param('shopId') shopId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('ไม่พบไฟล์');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น');
    }
    return this.service.uploadImage(shopId, file);
  }

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/images')
  getImages(@Param('shopId') shopId: string) {
    return this.service.getImages(shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':shopId/images/:id')
  deleteImage(
    @Param('shopId') shopId: string,
    @Param('id') id: string,
  ) {
    return this.service.deleteImage(id, shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/images/batch')
  @UseInterceptors(FilesInterceptor('files', 20, { limits: { fileSize: MAX_SIZE } }))
  uploadImages(
    @Param('shopId') shopId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('ไม่พบไฟล์');
    const invalid = files.find((f) => !f.mimetype.startsWith('image/'));
    if (invalid) throw new BadRequestException('อนุญาตเฉพาะไฟล์รูปภาพเท่านั้น');
    return Promise.all(files.map((f) => this.service.uploadImage(shopId, f)));
  }

  // The POS reads this to build the display URL it opens for staff. Owners can
  // read any shop's token; staff only their own.
  @UseGuards(JwtAuthGuard)
  @Get(':shopId/token')
  getDisplayToken(@Param('shopId') shopId: string, @CurrentUser() user: any) {
    if (user.role !== 'OWNER' && user.shopId !== shopId) {
      throw new ForbiddenException('Access denied');
    }
    return this.service.getDisplayToken(shopId);
  }

  // Single poll for the customer display — replaces separate state/search-results/images calls
  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/snapshot')
  getSnapshot(@Param('shopId') shopId: string) {
    return this.service.getSnapshot(shopId);
  }

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/:staffId/snapshot')
  getStaffSnapshot(@Param('shopId') shopId: string, @Param('staffId') staffId: string) {
    return this.service.getSnapshot(shopId, staffId);
  }

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/state')
  getState(@Param('shopId') shopId: string) {
    return this.service.getState(shopId);
  }

  // ── Per-staff display routes ─────────────────────────────────────────────

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/:staffId/state')
  getStaffState(@Param('shopId') shopId: string, @Param('staffId') staffId: string) {
    return this.service.getStaffState(shopId, staffId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/:staffId/active-quotation')
  setStaffQuotation(
    @Param('shopId') shopId: string,
    @Param('staffId') staffId: string,
    @Body() body: { quotationId: string },
  ) {
    return this.service.setStaffQuotation(shopId, staffId, body.quotationId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':shopId/:staffId/active-quotation')
  clearStaffQuotation(@Param('shopId') shopId: string, @Param('staffId') staffId: string) {
    return this.service.clearStaffQuotation(shopId, staffId);
  }

  @UseGuards(DisplayAccessGuard)
  @Delete(':shopId/:staffId/active-quotation/dismiss')
  dismissStaffQuotation(@Param('shopId') shopId: string, @Param('staffId') staffId: string) {
    return this.service.clearStaffQuotation(shopId, staffId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/:staffId/search-results')
  setStaffSearchResults(
    @Param('shopId') shopId: string,
    @Param('staffId') staffId: string,
    @Body() body: { results: any[] | null },
  ) {
    return this.service.setStaffSearchResults(shopId, staffId, body.results);
  }

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/:staffId/search-results')
  getStaffSearchResults(@Param('shopId') shopId: string, @Param('staffId') staffId: string) {
    return { results: this.service.getStaffSearchResults(shopId, staffId) };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/active-quotation')
  setActiveQuotation(
    @Param('shopId') shopId: string,
    @Body() body: { quotationId: string },
  ) {
    return this.service.setActiveQuotation(shopId, body.quotationId);
  }

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/active-quotation')
  getActiveQuotation(@Param('shopId') shopId: string) {
    return this.service.getActiveQuotation(shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':shopId/active-quotation')
  clearActiveQuotation(@Param('shopId') shopId: string) {
    return this.service.clearActiveQuotation(shopId);
  }

  @UseGuards(DisplayAccessGuard)
  @Delete(':shopId/active-quotation/dismiss')
  dismissActiveQuotation(@Param('shopId') shopId: string) {
    return this.service.clearActiveQuotation(shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/search-results')
  setSearchResults(@Param('shopId') shopId: string, @Body() body: { results: any[] | null }) {
    return this.service.setSearchResults(shopId, body.results);
  }

  @UseGuards(DisplayAccessGuard)
  @Get(':shopId/search-results')
  getSearchResults(@Param('shopId') shopId: string) {
    return { results: this.service.getSearchResults(shopId) };
  }
}

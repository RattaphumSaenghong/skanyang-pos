import {
  BadRequestException, Body, Controller, Delete, Get, Param,
  Post, UploadedFile, UseGuards, UseInterceptors, UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DisplayService } from './display.service';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

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

  @Get(':shopId/state')
  getState(@Param('shopId') shopId: string) {
    return this.service.getState(shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/active-quotation')
  setActiveQuotation(
    @Param('shopId') shopId: string,
    @Body() body: { quotationId: string },
  ) {
    return this.service.setActiveQuotation(shopId, body.quotationId);
  }

  @Get(':shopId/active-quotation')
  getActiveQuotation(@Param('shopId') shopId: string) {
    return this.service.getActiveQuotation(shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':shopId/active-quotation')
  clearActiveQuotation(@Param('shopId') shopId: string) {
    return this.service.clearActiveQuotation(shopId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':shopId/search-results')
  setSearchResults(@Param('shopId') shopId: string, @Body() body: { results: any[] | null }) {
    return this.service.setSearchResults(shopId, body.results);
  }

  @Get(':shopId/search-results')
  getSearchResults(@Param('shopId') shopId: string) {
    return { results: this.service.getSearchResults(shopId) };
  }
}

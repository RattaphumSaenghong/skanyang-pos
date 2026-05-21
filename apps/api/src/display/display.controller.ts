import {
  BadRequestException, Body, Controller, Delete, Get, Param,
  Post, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
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
  @Post(':shopId/active-quotation')
  setActiveQuotation(
    @Param('shopId') shopId: string,
    @Body() body: { quotationId: string },
  ) {
    return this.service.setActiveQuotation(shopId, body.quotationId);
  }
}

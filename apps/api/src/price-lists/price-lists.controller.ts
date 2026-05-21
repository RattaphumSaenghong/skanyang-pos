import {
  Controller, Delete, Get, Param, Patch, Post,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PriceListsService } from './price-lists.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('price-lists')
export class PriceListsController {
  constructor(private service: PriceListsService) {}

  @Roles(Role.OWNER)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
      const ok = /\.xlsx?$/i.test(file.originalname) &&
        ['application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/octet-stream'].includes(file.mimetype);
      cb(ok ? null : new Error('Only .xls / .xlsx files are accepted'), ok);
    },
  }))
  import(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: any) {
    return this.service.import(file, user.username);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get('active')
  findActive() {
    return this.service.findActive();
  }

  @Roles(Role.OWNER)
  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.service.activate(id);
  }

  @Roles(Role.OWNER)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }

  @Roles(Role.OWNER)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}

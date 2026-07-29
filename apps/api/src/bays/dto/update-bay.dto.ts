import { IsString, IsEnum, IsBoolean, IsInt, IsOptional } from 'class-validator';
import { BayMode } from '@prisma/client';

export class UpdateBayDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(BayMode)
  mode?: BayMode;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

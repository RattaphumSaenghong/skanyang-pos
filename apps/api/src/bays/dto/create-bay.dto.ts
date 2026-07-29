import { IsString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { BayMode } from '@prisma/client';

export class CreateBayDto {
  @IsString()
  name!: string;

  // Both fall back to the schema defaults (GENERAL / 0) when the UI omits them.
  @IsOptional()
  @IsEnum(BayMode)
  mode?: BayMode;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsString()
  shopId?: string;
}

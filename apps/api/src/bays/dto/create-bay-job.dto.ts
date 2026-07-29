import {
  IsString,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsInt,
  Min,
  IsDateString,
  ArrayNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BayJobKind } from '@prisma/client';

export class BayJobServiceDto {
  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  minutes?: number;
}

export class CreateBayJobDto {
  @IsEnum(BayJobKind)
  kind!: BayJobKind;

  @IsString()
  plateNumber!: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  vehicleModel?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @ValidateNested({ each: true })
  @Type(() => BayJobServiceDto)
  @ArrayNotEmpty()
  services!: BayJobServiceDto[];

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  bayId?: string;

  @IsOptional()
  @IsString()
  shopId?: string;
}

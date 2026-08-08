import {
  IsString,
  IsOptional,
  ValidateNested,
  IsInt,
  Min,
  ArrayNotEmpty,
  IsISO8601,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BayJobServiceUpdateDto {
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

export class UpdateBayJobDto {
  @IsOptional()
  @IsString()
  plateNumber?: string;

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

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BayJobServiceUpdateDto)
  @ArrayNotEmpty()
  services?: BayJobServiceUpdateDto[];
}

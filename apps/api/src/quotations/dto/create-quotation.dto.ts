import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQuotationItemDto {
  @IsString()
  @IsNotEmpty()
  priceEntryId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  @IsBoolean()
  @IsOptional()
  isIndividual?: boolean;
}

export class CreateQuotationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  items!: CreateQuotationItemDto[];

  @IsString()
  @IsOptional()
  shopId?: string;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  plateNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

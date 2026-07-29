import { IsString, IsNotEmpty, IsInt, Min, IsOptional } from 'class-validator';

export class CreateServiceFeeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(0)
  minPrice!: number;

  @IsInt()
  @Min(0)
  maxPrice!: number;

  @IsInt()
  @Min(1)
  maxQty!: number;

  @IsString()
  @IsNotEmpty()
  group!: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsString()
  @IsOptional()
  shopId?: string;
}

import { IsString, IsInt, Min, IsOptional, IsBoolean } from 'class-validator';

export class UpdateServiceFeeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  minPrice?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  maxPrice?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxQty?: number;

  @IsString()
  @IsOptional()
  group?: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

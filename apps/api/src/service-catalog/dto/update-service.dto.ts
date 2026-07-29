import { IsString, IsInt, Min, IsBoolean, IsOptional } from 'class-validator';

export class UpdateServiceDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  estimatedMinutes?: number;

  @IsBoolean()
  @IsOptional()
  requiresBay?: boolean;

  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}

import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
} from 'class-validator';

export class ImportBillBatchDto {
  @IsString()
  @IsNotEmpty()
  label!: string;

  // Multipart form fields arrive as strings, so the numbers need coercing
  // before @IsInt sees them.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2500) // Buddhist era
  periodYear!: number;

  /** Omit to use the file's first sheet — a single-sheet upload needs no picker. */
  @IsString()
  @IsOptional()
  billSheet?: string;

  @IsString()
  @IsOptional()
  itemSheet?: string;

  @IsString()
  @IsOptional()
  shopId?: string;
}

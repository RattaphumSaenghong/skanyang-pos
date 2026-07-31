import { IsOptional, IsString } from 'class-validator';

export class RefreshStockDto {
  /** Defaults to the workbook's first sheet when the file has only one. */
  @IsString()
  @IsOptional()
  sheet?: string;
}

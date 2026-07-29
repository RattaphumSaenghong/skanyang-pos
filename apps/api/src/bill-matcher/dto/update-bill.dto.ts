import { IsBoolean, IsOptional, IsArray } from 'class-validator';
import { MatchLine } from '../engine/types';

export class UpdateBillDto {
  @IsBoolean()
  @IsOptional()
  locked?: boolean;

  @IsArray()
  @IsOptional()
  lines?: MatchLine[];
}

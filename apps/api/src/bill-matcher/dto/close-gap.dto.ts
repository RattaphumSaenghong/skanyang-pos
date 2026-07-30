import { IsArray, IsOptional } from 'class-validator';
import { MatchLine } from '../engine/types';

export class CloseGapDto {
  /** The draft the operator has built so far. Nothing is persisted. */
  @IsArray()
  @IsOptional()
  lines?: MatchLine[];
}

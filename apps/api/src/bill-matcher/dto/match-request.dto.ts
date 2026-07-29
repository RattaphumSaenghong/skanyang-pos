import { IsInt, IsOptional, Min } from 'class-validator';

export class MatchRequestDto {
  @IsInt()
  @Min(100)
  @IsOptional()
  timeBudgetMs?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  seed?: number;
}

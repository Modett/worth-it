import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose, plainToInstance, Type } from 'class-transformer';
import { Prisma, Verdict } from '../../../generated/prisma/client';
import { parseStoredFactorBreakdown, ScoreFactor } from '../scoring.engine';

/** The Prisma row a score response is built from. */
export interface RegretScoreRow {
  id: string;
  itemId: string;
  score: number;
  factorBreakdown: Prisma.JsonValue;
  verdict: Verdict;
  computedAt: Date;
}

@Exclude()
export class ScoreFactorDto implements ScoreFactor {
  @Expose()
  @ApiProperty({ example: 'High price relative to your monthly budget' })
  label!: string;

  @Expose()
  @ApiProperty({ example: 30 })
  weight!: number;
}

/**
 * The only shape a regret score is ever serialised in. `pauseHours` is derived
 * from the item's price at read time and is not a column on `RegretScore`.
 * `factorBreakdown` on the wire is the factors array; the config `version` stays
 * inside the stored JSON so historical rows remain self-describing.
 */
@Exclude()
export class ScoreResponseDto {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @Expose()
  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @Expose()
  @ApiProperty({ example: 42, description: '0–100 Regret Risk. 0 when the verdict is YOU_DECIDE.' })
  score!: number;

  @Expose()
  @Type(() => ScoreFactorDto)
  @ApiProperty({ type: [ScoreFactorDto] })
  factorBreakdown!: ScoreFactorDto[];

  @Expose()
  @ApiProperty({ enum: Verdict, enumName: 'Verdict' })
  verdict!: Verdict;

  @Expose()
  @ApiProperty({ format: 'date-time' })
  computedAt!: string;

  @Expose()
  @ApiProperty({
    example: 24,
    description: 'Recommended cooling-off length in hours. Derived from price; not stored.',
  })
  pauseHours!: number;

  static fromRecord(row: RegretScoreRow, pauseHours: number): ScoreResponseDto {
    const stored = parseStoredFactorBreakdown(row.factorBreakdown);

    return plainToInstance(
      ScoreResponseDto,
      {
        id: row.id,
        itemId: row.itemId,
        score: row.score,
        factorBreakdown: stored.factors,
        verdict: row.verdict,
        computedAt: row.computedAt.toISOString(),
        pauseHours,
      },
      { excludeExtraneousValues: true },
    );
  }
}

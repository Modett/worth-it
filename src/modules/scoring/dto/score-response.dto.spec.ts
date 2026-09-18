import { Prisma, Verdict } from '../../../generated/prisma/client';
import { SCORE_LABELS } from '../scoring.engine';
import { RegretScoreRow, ScoreResponseDto } from './score-response.dto';

const SCORE_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const COMPUTED_AT = new Date('2026-09-17T12:00:00.000Z');

function storedScore(overrides: Partial<RegretScoreRow> = {}): RegretScoreRow {
  return {
    id: SCORE_ID,
    itemId: ITEM_ID,
    score: 42,
    factorBreakdown: {
      version: 1,
      factors: [{ label: SCORE_LABELS.similarOwnedYes, weight: 20 }],
    },
    verdict: Verdict.THINK_ABOUT_IT,
    computedAt: COMPUTED_AT,
    ...overrides,
  };
}

describe('ScoreResponseDto', () => {
  it('serialises the stored row plus derived pauseHours, unwrapping the version envelope', () => {
    expect(ScoreResponseDto.fromRecord(storedScore(), 24)).toEqual({
      id: SCORE_ID,
      itemId: ITEM_ID,
      score: 42,
      factorBreakdown: [{ label: SCORE_LABELS.similarOwnedYes, weight: 20 }],
      verdict: Verdict.THINK_ABOUT_IT,
      computedAt: COMPUTED_AT.toISOString(),
      pauseHours: 24,
    });
  });

  it('never exposes the stored config version on the wire', () => {
    const result = ScoreResponseDto.fromRecord(storedScore(), 24);

    expect(result).not.toHaveProperty('version');
    expect(JSON.stringify(result)).not.toContain('"version"');
  });

  it('keeps an empty factor list rather than failing when the JSON is malformed', () => {
    const result = ScoreResponseDto.fromRecord(
      storedScore({ factorBreakdown: { unexpected: true } as Prisma.JsonObject }),
      48,
    );

    expect(result.factorBreakdown).toEqual([]);
    expect(result.pauseHours).toBe(48);
  });
});

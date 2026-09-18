import { ItemStatus, Verdict } from '../../generated/prisma/client';
import { SCORING_CONFIG, SCORING_CONFIG_V1 } from './scoring.config';

describe('SCORING_CONFIG', () => {
  it('is the live alias for v1, so a v2 bump is a pointer change not an edit of v1', () => {
    expect(SCORING_CONFIG).toBe(SCORING_CONFIG_V1);
    expect(SCORING_CONFIG.version).toBe(1);
  });

  it('keeps factor maxima adding up to 100, so a full-weight item lands on the cap', () => {
    const { priceVsBudget, similarOwned, saleUrgency, recency, categoryRegretRate } =
      SCORING_CONFIG.weights;

    expect(
      priceVsBudget.max + similarOwned.max + saleUrgency.max + recency.max + categoryRegretRate.max,
    ).toBe(100);
  });

  it('covers 0–100 with inclusive, non-overlapping verdict bands', () => {
    const maxima = SCORING_CONFIG.verdictThresholds.map((threshold) => threshold.max);

    expect(maxima).toEqual([30, 50, 70, 100]);
    expect(SCORING_CONFIG.verdictThresholds.map((threshold) => threshold.verdict)).toEqual([
      Verdict.GO_FOR_IT,
      Verdict.THINK_ABOUT_IT,
      Verdict.PAUSE,
      Verdict.LIKELY_REGRET,
    ]);
  });

  it('ends the recency and pause tables with a catch-all band', () => {
    const lastRecency = SCORING_CONFIG.recencyBuckets[SCORING_CONFIG.recencyBuckets.length - 1];
    const lastPause = SCORING_CONFIG.pauseHoursByPrice[SCORING_CONFIG.pauseHoursByPrice.length - 1];

    expect(lastRecency?.maxAgeHours).toBeNull();
    expect(lastPause?.maxPrice).toBeNull();
  });

  it('only scores items whose purchase decision is still open', () => {
    expect(SCORING_CONFIG.scorableStatuses).toEqual([ItemStatus.WISHLIST, ItemStatus.PAUSED]);
  });

  it('uses a category sample of 5 before trusting a personal regret rate', () => {
    expect(SCORING_CONFIG.weights.categoryRegretRate.minSampleSize).toBe(5);
    expect(SCORING_CONFIG.weights.categoryRegretRate.defaultWhenInsufficientData).toBe(10);
  });
});

import { ItemStatus, Verdict } from '../../generated/prisma/client';

/**
 * Version 1 of the deterministic Regret Risk engine.
 *
 * Historical `RegretScore.factorBreakdown` rows embed `version: 1` in the JSON
 * itself, so a future `SCORING_CONFIG_V2` (different weights, extra factors)
 * can ship without a schema change or a backfill: old rows stay readable as
 * v1 breakdowns, new rows store v2. `SCORING_CONFIG` is whichever version the
 * live engine uses; bump that alias, not the v1 object.
 */
export const SCORING_CONFIG_V1 = {
  version: 1,

  weights: {
    priceVsBudget: { max: 30 },
    similarOwned: { max: 20 },
    saleUrgency: { max: 15 },
    recency: { max: 15 },
    categoryRegretRate: {
      max: 20,
      defaultWhenInsufficientData: 10,
      minSampleSize: 5,
    },
  },

  /**
   * First matching band wins; `max` is inclusive. A score of exactly 30 is
   * GO_FOR_IT, 31 is THINK_ABOUT_IT, and so on up to 100.
   */
  verdictThresholds: [
    { max: 30, verdict: Verdict.GO_FOR_IT },
    { max: 50, verdict: Verdict.THINK_ABOUT_IT },
    { max: 70, verdict: Verdict.PAUSE },
    { max: 100, verdict: Verdict.LIKELY_REGRET },
  ],

  /**
   * Cooling-off length suggested from price. First matching band wins; the
   * trailing `maxPrice: null` is the catch-all. The Pauses module (step 7)
   * reads this through `pauseHoursForPrice` rather than copying the table.
   */
  pauseHoursByPrice: [
    { maxPrice: 150, hours: 24 },
    { maxPrice: 500, hours: 48 },
    { maxPrice: null, hours: 72 },
  ],

  /**
   * Impulse proxy: newer discoveries score higher. `maxAgeHours` is inclusive,
   * so an item discovered exactly 1 hour ago sits in the first bucket.
   */
  recencyBuckets: [
    { maxAgeHours: 1, points: 15 },
    { maxAgeHours: 24, points: 10 },
    { maxAgeHours: 168, points: 5 },
    { maxAgeHours: null, points: 0 },
  ],

  /**
   * Re-scoring is only meaningful while the purchase decision is still open.
   * PURCHASED / SKIPPED / RETURNED already have an outcome; their score is
   * history, not something to recompute.
   */
  scorableStatuses: [ItemStatus.WISHLIST, ItemStatus.PAUSED],
} as const;

/** Live engine version. Point this at v2 when the weights change. */
export const SCORING_CONFIG = SCORING_CONFIG_V1;

export type ScoringConfigV1 = typeof SCORING_CONFIG_V1;

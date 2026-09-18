import { Verdict } from '../../generated/prisma/client';
import { SCORING_CONFIG } from './scoring.config';
import {
  categoryRegretRatePoints,
  computeRegretScore,
  pauseHoursForPrice,
  parseStoredFactorBreakdown,
  priceVsBudgetPoints,
  recencyPoints,
  saleUrgencyPoints,
  SCORE_LABELS,
  ScoreComputationInput,
  similarOwnedPoints,
  verdictFor,
} from './scoring.engine';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const MS_PER_HOUR = 60 * 60 * 1000;

/** Older than the last recency bucket, so recency contributes 0. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');

function hoursAgo(hours: number, extraMs = 0): Date {
  return new Date(NOW.getTime() - hours * MS_PER_HOUR - extraMs);
}

/**
 * A baseline that contributes nothing except the category fallback of 10:
 * tiny price vs a huge budget, not similar, no sale, discovered long ago,
 * no personal stats.
 */
function baseline(overrides: Partial<ScoreComputationInput> = {}): ScoreComputationInput {
  return {
    price: 0.01,
    discoveredAt: LONG_AGO,
    detectedSaleLanguage: false,
    monthlyBudget: SCORING_CONFIG.weights.priceVsBudget.max * 10_000,
    similarOwned: false,
    categoryRegretStats: null,
    ...overrides,
  };
}

/** Budget 300 with price 10 yields exactly 1 priceVsBudget point. */
const UNIT_BUDGET = 300;
const UNIT_PRICE = 10;

function weightFor(input: ScoreComputationInput, label: string): number | undefined {
  return computeRegretScore(input, NOW).factorBreakdown.factors.find(
    (factor) => factor.label === label,
  )?.weight;
}

describe('priceVsBudgetPoints', () => {
  const { max } = SCORING_CONFIG.weights.priceVsBudget;
  const budget = 500;

  it('is 0 when the price is a rounding crumb against the budget', () => {
    expect(priceVsBudgetPoints(0.01, budget)).toBeCloseTo((0.01 / budget) * max);
  });

  it('is half the cap when the price is half the monthly budget', () => {
    expect(priceVsBudgetPoints(budget / 2, budget)).toBe(max / 2);
  });

  it('hits the cap when the price equals the monthly budget', () => {
    expect(priceVsBudgetPoints(budget, budget)).toBe(max);
  });

  it('stays at the cap when the price exceeds the monthly budget', () => {
    expect(priceVsBudgetPoints(budget * 2, budget)).toBe(max);
  });

  it('matches the spec form (price / budget) * 100 * 0.3', () => {
    const price = 150;
    expect(priceVsBudgetPoints(price, budget)).toBe((price / budget) * 100 * 0.3);
  });
});

describe('similarOwnedPoints', () => {
  it('is the full weight when the user already owns something similar', () => {
    expect(similarOwnedPoints(true)).toBe(SCORING_CONFIG.weights.similarOwned.max);
  });

  it('is 0 when they do not', () => {
    expect(similarOwnedPoints(false)).toBe(0);
  });
});

describe('saleUrgencyPoints', () => {
  it('is the full weight when sale language was detected', () => {
    expect(saleUrgencyPoints(true)).toBe(SCORING_CONFIG.weights.saleUrgency.max);
  });

  it('is 0 otherwise', () => {
    expect(saleUrgencyPoints(false)).toBe(0);
  });
});

describe('recencyPoints', () => {
  const [withinHour, withinDay, withinWeek, older] = SCORING_CONFIG.recencyBuckets;

  it('is the highest bucket for a discovery happening now', () => {
    expect(recencyPoints(NOW, NOW)).toBe(withinHour.points);
  });

  it('includes an item discovered exactly 1 hour ago in the first bucket', () => {
    expect(recencyPoints(hoursAgo(withinHour.maxAgeHours), NOW)).toBe(withinHour.points);
  });

  it('drops to the day bucket one millisecond after the 1-hour edge', () => {
    expect(recencyPoints(hoursAgo(withinHour.maxAgeHours, 1), NOW)).toBe(withinDay.points);
  });

  it('includes an item discovered exactly 24 hours ago in the day bucket', () => {
    expect(recencyPoints(hoursAgo(withinDay.maxAgeHours), NOW)).toBe(withinDay.points);
  });

  it('drops to the week bucket one millisecond after the 24-hour edge', () => {
    expect(recencyPoints(hoursAgo(withinDay.maxAgeHours, 1), NOW)).toBe(withinWeek.points);
  });

  it('includes an item discovered exactly 168 hours ago in the week bucket', () => {
    expect(recencyPoints(hoursAgo(withinWeek.maxAgeHours), NOW)).toBe(withinWeek.points);
  });

  it('falls to zero one millisecond after the 168-hour edge', () => {
    expect(recencyPoints(hoursAgo(withinWeek.maxAgeHours, 1), NOW)).toBe(older.points);
  });
});

describe('categoryRegretRatePoints', () => {
  const { max, defaultWhenInsufficientData, minSampleSize } =
    SCORING_CONFIG.weights.categoryRegretRate;

  it('uses the default when no CategoryRegretStats row exists', () => {
    expect(categoryRegretRatePoints(null)).toBe(defaultWhenInsufficientData);
  });

  it('uses the default when sampleSize is one below the minimum', () => {
    expect(categoryRegretRatePoints({ sampleSize: minSampleSize - 1, regretRate: 1 })).toBe(
      defaultWhenInsufficientData,
    );
  });

  it('trusts the rate once sampleSize equals the minimum', () => {
    expect(categoryRegretRatePoints({ sampleSize: minSampleSize, regretRate: 1 })).toBe(max);
  });

  it('is 0 when the user has enough data and no regrets in the category', () => {
    expect(categoryRegretRatePoints({ sampleSize: minSampleSize, regretRate: 0 })).toBe(0);
  });

  it('scales linearly with the regret rate', () => {
    expect(categoryRegretRatePoints({ sampleSize: minSampleSize, regretRate: 0.5 })).toBe(max / 2);
  });
});

describe('verdictFor', () => {
  it.each([
    [0, Verdict.GO_FOR_IT],
    [30, Verdict.GO_FOR_IT],
    [31, Verdict.THINK_ABOUT_IT],
    [50, Verdict.THINK_ABOUT_IT],
    [51, Verdict.PAUSE],
    [70, Verdict.PAUSE],
    [71, Verdict.LIKELY_REGRET],
    [100, Verdict.LIKELY_REGRET],
  ] as const)('maps a score of %s to %s', (score, verdict) => {
    expect(verdictFor(score)).toBe(verdict);
  });
});

describe('pauseHoursForPrice', () => {
  const [under150, under500, above] = SCORING_CONFIG.pauseHoursByPrice;

  it('uses the shortest pause at the bottom of the first band', () => {
    expect(pauseHoursForPrice(0.01)).toBe(under150.hours);
  });

  it('uses the shortest pause at the $150 edge', () => {
    expect(pauseHoursForPrice(under150.maxPrice)).toBe(under150.hours);
  });

  it('steps up one cent past $150', () => {
    expect(pauseHoursForPrice(under150.maxPrice + 0.01)).toBe(under500.hours);
  });

  it('keeps the middle band at the $500 edge', () => {
    expect(pauseHoursForPrice(under500.maxPrice)).toBe(under500.hours);
  });

  it('uses the longest pause one cent past $500', () => {
    expect(pauseHoursForPrice(under500.maxPrice + 0.01)).toBe(above.hours);
  });

  it('uses the longest pause for an arbitrarily expensive item', () => {
    expect(pauseHoursForPrice(10_000)).toBe(above.hours);
  });
});

describe('computeRegretScore — YOU_DECIDE', () => {
  it('does not divide by a monthlyBudget of 0', () => {
    const result = computeRegretScore(baseline({ monthlyBudget: 0 }), NOW);

    expect(result.verdict).toBe(Verdict.YOU_DECIDE);
    expect(result.score).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.factorBreakdown.factors).toEqual([
      { label: SCORE_LABELS.missingBudget, weight: 0 },
    ]);
  });

  it('treats a missing monthlyBudget the same way', () => {
    const result = computeRegretScore(baseline({ monthlyBudget: null }), NOW);

    expect(result.verdict).toBe(Verdict.YOU_DECIDE);
    expect(result.factorBreakdown.factors[0]?.label).toBe(SCORE_LABELS.missingBudget);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['missing', null],
    ['NaN', Number.NaN],
  ] as const)('returns YOU_DECIDE when price is %s rather than a numeric score', (_case, price) => {
    const result = computeRegretScore(baseline({ price }), NOW);

    expect(result.verdict).toBe(Verdict.YOU_DECIDE);
    expect(result.score).toBe(0);
    expect(result.factorBreakdown.factors).toEqual([
      { label: SCORE_LABELS.invalidPrice, weight: 0 },
    ]);
  });
});

describe('computeRegretScore — composition at verdict boundaries', () => {
  const enoughDataNoRegret = {
    sampleSize: SCORING_CONFIG.weights.categoryRegretRate.minSampleSize,
    regretRate: 0,
  };
  const enoughDataFullRegret = {
    sampleSize: SCORING_CONFIG.weights.categoryRegretRate.minSampleSize,
    regretRate: 1,
  };

  it('lands on 30 GO_FOR_IT: similarOwned + the category fallback, nothing else', () => {
    const result = computeRegretScore(baseline({ similarOwned: true }), NOW);

    expect(result.score).toBe(30);
    expect(result.verdict).toBe(Verdict.GO_FOR_IT);
    expect(result.factorBreakdown.version).toBe(SCORING_CONFIG.version);
  });

  it('lands on 31 THINK_ABOUT_IT: the 30 composition plus exactly 1 priceVsBudget point', () => {
    const result = computeRegretScore(
      baseline({ similarOwned: true, price: UNIT_PRICE, monthlyBudget: UNIT_BUDGET }),
      NOW,
    );

    expect(result.score).toBe(31);
    expect(result.verdict).toBe(Verdict.THINK_ABOUT_IT);
  });

  it('lands on 50 THINK_ABOUT_IT: similarOwned + sale + freshest recency, no category weight', () => {
    const result = computeRegretScore(
      baseline({
        similarOwned: true,
        detectedSaleLanguage: true,
        discoveredAt: NOW,
        categoryRegretStats: enoughDataNoRegret,
      }),
      NOW,
    );

    expect(result.score).toBe(50);
    expect(result.verdict).toBe(Verdict.THINK_ABOUT_IT);
  });

  it('lands on 51 PAUSE: the 50 composition plus exactly 1 priceVsBudget point', () => {
    const result = computeRegretScore(
      baseline({
        similarOwned: true,
        detectedSaleLanguage: true,
        discoveredAt: NOW,
        categoryRegretStats: enoughDataNoRegret,
        price: UNIT_PRICE,
        monthlyBudget: UNIT_BUDGET,
      }),
      NOW,
    );

    expect(result.score).toBe(51);
    expect(result.verdict).toBe(Verdict.PAUSE);
  });

  it('lands on 70 PAUSE: similarOwned + sale + freshest recency + a 100% category regret rate', () => {
    const result = computeRegretScore(
      baseline({
        similarOwned: true,
        detectedSaleLanguage: true,
        discoveredAt: NOW,
        categoryRegretStats: enoughDataFullRegret,
      }),
      NOW,
    );

    expect(result.score).toBe(70);
    expect(result.verdict).toBe(Verdict.PAUSE);
  });

  it('lands on 71 LIKELY_REGRET: the 70 composition plus exactly 1 priceVsBudget point', () => {
    const result = computeRegretScore(
      baseline({
        similarOwned: true,
        detectedSaleLanguage: true,
        discoveredAt: NOW,
        categoryRegretStats: enoughDataFullRegret,
        price: UNIT_PRICE,
        monthlyBudget: UNIT_BUDGET,
      }),
      NOW,
    );

    expect(result.score).toBe(71);
    expect(result.verdict).toBe(Verdict.LIKELY_REGRET);
  });
});

describe('computeRegretScore — cap, fallback and labels', () => {
  it('never exceeds 100 even when a contrived regretRate would oversum', () => {
    const result = computeRegretScore(
      baseline({
        price: 500,
        monthlyBudget: 500,
        similarOwned: true,
        detectedSaleLanguage: true,
        discoveredAt: NOW,
        categoryRegretStats: { sampleSize: 20, regretRate: 2 },
      }),
      NOW,
    );

    expect(result.score).toBe(100);
    expect(result.verdict).toBe(Verdict.LIKELY_REGRET);
    const raw =
      SCORING_CONFIG.weights.priceVsBudget.max +
      SCORING_CONFIG.weights.similarOwned.max +
      SCORING_CONFIG.weights.saleUrgency.max +
      SCORING_CONFIG.weights.recency.max +
      2 * SCORING_CONFIG.weights.categoryRegretRate.max;
    expect(raw).toBeGreaterThan(100);
  });

  it('falls back to defaultWhenInsufficientData when stats are missing, without erroring', () => {
    expect(weightFor(baseline(), SCORE_LABELS.categoryInsufficient)).toBe(
      SCORING_CONFIG.weights.categoryRegretRate.defaultWhenInsufficientData,
    );
  });

  it('embeds the live config version in the stored breakdown envelope', () => {
    const result = computeRegretScore(baseline(), NOW);

    expect(result.factorBreakdown.version).toBe(1);
    expect(result.factorBreakdown.factors).toHaveLength(5);
  });

  it('recommends pause hours from price independently of the score', () => {
    const cheap = computeRegretScore(baseline({ price: 20, monthlyBudget: 500 }), NOW);
    const dear = computeRegretScore(baseline({ price: 800, monthlyBudget: 5000 }), NOW);

    expect(cheap.pauseHours).toBe(24);
    expect(dear.pauseHours).toBe(72);
  });

  it('uses the high-price label when the price hits the budget cap', () => {
    const result = computeRegretScore(baseline({ price: 500, monthlyBudget: 500 }), NOW);

    expect(
      result.factorBreakdown.factors.some((factor) => factor.label === SCORE_LABELS.priceHigh),
    ).toBe(true);
  });
});

describe('parseStoredFactorBreakdown', () => {
  it('reads a v1 envelope back into factors', () => {
    expect(
      parseStoredFactorBreakdown({
        version: 1,
        factors: [{ label: SCORE_LABELS.similarOwnedYes, weight: 20 }],
      }),
    ).toEqual({
      version: 1,
      factors: [{ label: SCORE_LABELS.similarOwnedYes, weight: 20 }],
    });
  });

  it('survives a malformed payload so a bad historical row cannot 500 a GET', () => {
    expect(parseStoredFactorBreakdown(['not', 'an', 'envelope'])).toEqual({
      version: SCORING_CONFIG.version,
      factors: [],
    });
  });
});

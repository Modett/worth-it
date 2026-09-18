import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ItemStatus, Prisma, Verdict } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ItemNotFoundException } from '../items/exceptions/items.exceptions';
import { ItemNotScorableException, ScoreNotFoundException } from './exceptions/scoring.exceptions';
import { SCORE_LABELS } from './scoring.engine';
import { ScoringService } from './scoring.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const SCORE_ID = '55555555-5555-4555-8555-555555555555';
const TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');
const COMPUTED_AT = new Date('2026-09-17T12:00:00.000Z');

type ItemDelegate = { findFirst: jest.Mock };
type StatsDelegate = { findUnique: jest.Mock };
type ScoreDelegate = { upsert: jest.Mock };

describe('ScoringService', () => {
  let service: ScoringService;
  let itemDelegate: ItemDelegate;
  let statsDelegate: StatsDelegate;
  let scoreDelegate: ScoreDelegate;

  beforeEach(async () => {
    itemDelegate = { findFirst: jest.fn() };
    statsDelegate = { findUnique: jest.fn().mockResolvedValue(null) };
    scoreDelegate = { upsert: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ScoringService,
        {
          provide: PrismaService,
          useValue: {
            item: itemDelegate,
            categoryRegretStats: statsDelegate,
            regretScore: scoreDelegate,
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ScoringService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function ownedItem(
    overrides: {
      userId?: string;
      status?: ItemStatus;
      price?: string;
      monthlyBudget?: string;
      detectedSaleLanguage?: boolean;
      regretScore?: Record<string, unknown> | null;
    } = {},
  ) {
    return {
      id: ITEM_ID,
      status: overrides.status ?? ItemStatus.WISHLIST,
      price: new Prisma.Decimal(overrides.price ?? '200'),
      discoveredAt: TIMESTAMP,
      category: 'FASHION',
      detectedSaleLanguage: overrides.detectedSaleLanguage ?? false,
      user: { monthlyBudget: new Prisma.Decimal(overrides.monthlyBudget ?? '300') },
      regretScore: overrides.regretScore ?? null,
    };
  }

  function storedScore(overrides: Record<string, unknown> = {}) {
    return {
      id: SCORE_ID,
      itemId: ITEM_ID,
      score: 30,
      factorBreakdown: {
        version: 1,
        factors: [
          { label: SCORE_LABELS.priceLow, weight: 0 },
          { label: SCORE_LABELS.similarOwnedYes, weight: 20 },
          { label: SCORE_LABELS.saleNo, weight: 0 },
          { label: SCORE_LABELS.recencyOlder, weight: 0 },
          { label: SCORE_LABELS.categoryInsufficient, weight: 10 },
        ],
      },
      verdict: Verdict.GO_FOR_IT,
      computedAt: COMPUTED_AT,
      ...overrides,
    };
  }

  describe('scoreItem', () => {
    it('upserts a score for a wishlist item and returns pauseHours derived from price', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem());
      scoreDelegate.upsert.mockResolvedValue(storedScore());

      const result = await service.scoreItem(USER_ID, ITEM_ID, { similarOwned: false });

      expect(itemDelegate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID, userId: USER_ID } }),
      );
      expect(statsDelegate.findUnique).toHaveBeenCalledWith({
        where: { userId_category: { userId: USER_ID, category: 'FASHION' } },
        select: { regretRate: true, sampleSize: true },
      });

      const [[upsertArgs]] = scoreDelegate.upsert.mock.calls as [
        [{ where: { itemId: string }; create: { score: number; verdict: Verdict } }],
      ];
      expect(upsertArgs.where).toEqual({ itemId: ITEM_ID });
      expect(upsertArgs.create.score).toBe(30);
      expect(upsertArgs.create.verdict).toBe(Verdict.GO_FOR_IT);

      expect(result.pauseHours).toBe(48);
      expect(result.score).toBe(30);
      expect(result.verdict).toBe(Verdict.GO_FOR_IT);
    });

    it('allows scoring a PAUSED item', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem({ status: ItemStatus.PAUSED }));
      scoreDelegate.upsert.mockResolvedValue(storedScore());

      await expect(
        service.scoreItem(USER_ID, ITEM_ID, { similarOwned: true }),
      ).resolves.toMatchObject({ itemId: ITEM_ID });
    });

    it.each([ItemStatus.PURCHASED, ItemStatus.SKIPPED, ItemStatus.RETURNED])(
      'refuses to score a %s item',
      async (status) => {
        itemDelegate.findFirst.mockResolvedValue(ownedItem({ status }));

        await expect(
          service.scoreItem(USER_ID, ITEM_ID, { similarOwned: false }),
        ).rejects.toBeInstanceOf(ItemNotScorableException);
        expect(scoreDelegate.upsert).not.toHaveBeenCalled();
      },
    );

    it("reports another user's item as not found rather than forbidden", async () => {
      itemDelegate.findFirst.mockImplementation(
        ({ where }: { where: { id: string; userId: string } }) =>
          Promise.resolve(where.userId === USER_ID ? ownedItem() : null),
      );

      await expect(
        service.scoreItem(OTHER_USER_ID, ITEM_ID, { similarOwned: false }),
      ).rejects.toBeInstanceOf(ItemNotFoundException);
      expect(scoreDelegate.upsert).not.toHaveBeenCalled();
    });

    it('still scores when CategoryRegretStats is absent', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem());
      statsDelegate.findUnique.mockResolvedValue(null);
      scoreDelegate.upsert.mockResolvedValue(storedScore());

      await expect(
        service.scoreItem(USER_ID, ITEM_ID, { similarOwned: false }),
      ).resolves.toMatchObject({ score: 30 });

      const [[upsertArgs]] = scoreDelegate.upsert.mock.calls as [
        [{ create: { factorBreakdown: { factors: { label: string; weight: number }[] } } }],
      ];
      const category = upsertArgs.create.factorBreakdown.factors.find(
        (factor) => factor.label === SCORE_LABELS.categoryInsufficient,
      );
      expect(category?.weight).toBe(10);
    });

    it('persists YOU_DECIDE when the monthly budget is 0 rather than writing NaN', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem({ monthlyBudget: '0' }));
      scoreDelegate.upsert.mockResolvedValue(
        storedScore({ score: 0, verdict: Verdict.YOU_DECIDE }),
      );

      await service.scoreItem(USER_ID, ITEM_ID, { similarOwned: false });

      const [[upsertArgs]] = scoreDelegate.upsert.mock.calls as [
        [{ create: { score: number; verdict: Verdict } }],
      ];
      expect(upsertArgs.create.score).toBe(0);
      expect(upsertArgs.create.verdict).toBe(Verdict.YOU_DECIDE);
      expect(Number.isFinite(upsertArgs.create.score)).toBe(true);
    });

    it('replaces the previous row on recompute rather than inserting a second one', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem());
      scoreDelegate.upsert.mockResolvedValue(storedScore({ score: 50 }));

      await service.scoreItem(USER_ID, ITEM_ID, { similarOwned: true });

      const [[upsertArgs]] = scoreDelegate.upsert.mock.calls as [
        [{ where: { itemId: string }; update: { computedAt: Date } }],
      ];
      expect(upsertArgs.where).toEqual({ itemId: ITEM_ID });
      expect(upsertArgs.update.computedAt).toBeInstanceOf(Date);
    });
  });

  describe('getScore', () => {
    it('returns the stored score plus pauseHours derived from the current price', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem({ regretScore: storedScore() }));

      const result = await service.getScore(USER_ID, ITEM_ID);

      expect(result).toMatchObject({
        id: SCORE_ID,
        itemId: ITEM_ID,
        score: 30,
        verdict: Verdict.GO_FOR_IT,
        pauseHours: 48,
      });
    });

    it('uses a distinct 404 when the item exists but has never been scored', async () => {
      itemDelegate.findFirst.mockResolvedValue(ownedItem({ regretScore: null }));

      await expect(service.getScore(USER_ID, ITEM_ID)).rejects.toBeInstanceOf(
        ScoreNotFoundException,
      );
    });

    it('uses Item not found when the item is missing or belongs to someone else', async () => {
      itemDelegate.findFirst.mockResolvedValue(null);

      await expect(service.getScore(USER_ID, ITEM_ID)).rejects.toBeInstanceOf(
        ItemNotFoundException,
      );
    });
  });
});

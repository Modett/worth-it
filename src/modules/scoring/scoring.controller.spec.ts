import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Verdict } from '../../generated/prisma/client';
import { ScoreResponseDto } from './dto/score-response.dto';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

const score: ScoreResponseDto = {
  id: '55555555-5555-4555-8555-555555555555',
  itemId: ITEM_ID,
  score: 42,
  factorBreakdown: [{ label: 'You already own something similar', weight: 20 }],
  verdict: Verdict.THINK_ABOUT_IT,
  computedAt: '2026-09-17T12:00:00.000Z',
  pauseHours: 24,
};

describe('ScoringController', () => {
  let controller: ScoringController;
  let scoringService: { scoreItem: jest.Mock; getScore: jest.Mock };

  beforeEach(async () => {
    scoringService = { scoreItem: jest.fn(), getScore: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [ScoringController],
      providers: [{ provide: ScoringService, useValue: scoringService }],
    }).compile();

    controller = moduleRef.get(ScoringController);
  });

  const reflector = new Reflector();

  it('scores against the id from the access token, not one from the body', async () => {
    scoringService.scoreItem.mockResolvedValue(score);
    const dto = { similarOwned: true };

    await expect(controller.score(USER_ID, ITEM_ID, dto)).resolves.toBe(score);
    expect(scoringService.scoreItem).toHaveBeenCalledWith(USER_ID, ITEM_ID, dto);
  });

  it('scopes a score read to the caller', async () => {
    scoringService.getScore.mockResolvedValue(score);

    await expect(controller.getScore(USER_ID, ITEM_ID)).resolves.toBe(score);
    expect(scoringService.getScore).toHaveBeenCalledWith(USER_ID, ITEM_ID);
  });

  describe('route protection', () => {
    it.each(['score', 'getScore'] as const)(
      '%s is not @Public(), so the global JWT guard protects it',
      (route) => {
        expect(
          reflector.get<boolean | undefined>(IS_PUBLIC_KEY, ScoringController.prototype[route]),
        ).toBeUndefined();
      },
    );
  });
});

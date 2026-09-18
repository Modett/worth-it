import { Injectable, Logger } from '@nestjs/common';
import { ItemStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ItemNotFoundException } from '../items/exceptions/items.exceptions';
import { ComputeScoreDto } from './dto/compute-score.dto';
import { ScoreResponseDto } from './dto/score-response.dto';
import { ItemNotScorableException, ScoreNotFoundException } from './exceptions/scoring.exceptions';
import { SCORING_CONFIG } from './scoring.config';
import { computeRegretScore, pauseHoursForPrice } from './scoring.engine';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(private readonly prismaService: PrismaService) {}

  async scoreItem(userId: string, itemId: string, dto: ComputeScoreDto): Promise<ScoreResponseDto> {
    const item = await this.requireOwnedScorableItem(userId, itemId);

    const categoryRegretStats = await this.prismaService.categoryRegretStats.findUnique({
      where: { userId_category: { userId, category: item.category } },
      select: { regretRate: true, sampleSize: true },
    });

    const computation = computeRegretScore({
      price: Number(item.price),
      discoveredAt: item.discoveredAt,
      detectedSaleLanguage: item.detectedSaleLanguage,
      monthlyBudget: Number(item.user.monthlyBudget),
      similarOwned: dto.similarOwned,
      categoryRegretStats,
    });

    const computedAt = new Date();
    const factorBreakdown = toJsonBreakdown(computation.factorBreakdown);

    const row = await this.prismaService.regretScore.upsert({
      where: { itemId: item.id },
      create: {
        itemId: item.id,
        score: computation.score,
        factorBreakdown,
        verdict: computation.verdict,
        computedAt,
      },
      update: {
        score: computation.score,
        factorBreakdown,
        verdict: computation.verdict,
        computedAt,
      },
    });

    this.logger.log({ userId, itemId, verdict: computation.verdict }, 'Regret score computed');

    return ScoreResponseDto.fromRecord(row, computation.pauseHours);
  }

  async getScore(userId: string, itemId: string): Promise<ScoreResponseDto> {
    const item = await this.prismaService.item.findFirst({
      where: { id: itemId, userId },
      select: { price: true, regretScore: true },
    });

    if (!item) {
      throw new ItemNotFoundException();
    }

    if (!item.regretScore) {
      throw new ScoreNotFoundException();
    }

    return ScoreResponseDto.fromRecord(item.regretScore, pauseHoursForPrice(Number(item.price)));
  }

  /**
   * Ownership first (404-not-403), then the scorable-status check. A neighbour's
   * PURCHASED item must not leak that it exists by returning 400 instead of 404.
   */
  private async requireOwnedScorableItem(
    userId: string,
    itemId: string,
  ): Promise<{
    id: string;
    status: ItemStatus;
    price: Prisma.Decimal;
    discoveredAt: Date;
    category: string;
    detectedSaleLanguage: boolean;
    user: { monthlyBudget: Prisma.Decimal };
  }> {
    const item = await this.prismaService.item.findFirst({
      where: { id: itemId, userId },
      select: {
        id: true,
        status: true,
        price: true,
        discoveredAt: true,
        category: true,
        detectedSaleLanguage: true,
        user: { select: { monthlyBudget: true } },
      },
    });

    if (!item) {
      throw new ItemNotFoundException();
    }

    if (!isScorableStatus(item.status)) {
      throw new ItemNotScorableException(item.status);
    }

    return item;
  }
}

function isScorableStatus(
  status: ItemStatus,
): status is (typeof SCORING_CONFIG.scorableStatuses)[number] {
  return (SCORING_CONFIG.scorableStatuses as readonly ItemStatus[]).includes(status);
}

function toJsonBreakdown(breakdown: {
  version: number;
  factors: { label: string; weight: number }[];
}): Prisma.InputJsonObject {
  return {
    version: breakdown.version,
    factors: breakdown.factors.map((factor) => ({
      label: factor.label,
      weight: factor.weight,
    })),
  };
}

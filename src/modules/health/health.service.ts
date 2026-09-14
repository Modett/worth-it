import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { DependencyStatus, HealthResponseDto } from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [db, redis] = await Promise.all([
      this.toStatus(this.prismaService.isHealthy()),
      this.toStatus(this.redisService.isHealthy()),
    ]);

    return {
      status: db === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      db,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  private async toStatus(probe: Promise<boolean>): Promise<DependencyStatus> {
    return (await probe) ? 'ok' : 'error';
  }
}

import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let prismaService: { isHealthy: jest.Mock };
  let redisService: { isHealthy: jest.Mock };

  beforeEach(async () => {
    prismaService = { isHealthy: jest.fn() };
    redisService = { isHealthy: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it('reports ok when both dependencies respond', async () => {
    prismaService.isHealthy.mockResolvedValue(true);
    redisService.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    expect(result).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as string,
    });
  });

  it('reports degraded with the failing dependency marked when the database is down', async () => {
    prismaService.isHealthy.mockResolvedValue(false);
    redisService.isHealthy.mockResolvedValue(true);

    const result = await service.check();

    expect(result).toMatchObject({ status: 'degraded', db: 'error', redis: 'ok' });
  });

  it('reports degraded when Redis is down', async () => {
    prismaService.isHealthy.mockResolvedValue(true);
    redisService.isHealthy.mockResolvedValue(false);

    const result = await service.check();

    expect(result).toMatchObject({ status: 'degraded', db: 'ok', redis: 'error' });
  });

  it('probes both dependencies concurrently', async () => {
    prismaService.isHealthy.mockResolvedValue(true);
    redisService.isHealthy.mockResolvedValue(true);

    await service.check();

    expect(prismaService.isHealthy).toHaveBeenCalledTimes(1);
    expect(redisService.isHealthy).toHaveBeenCalledTimes(1);
  });
});

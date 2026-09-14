import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: keyof EnvironmentVariables) => {
        const values: Partial<EnvironmentVariables> = {
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
          DATABASE_POOL_MAX: 2,
        };
        return values[key];
      }),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    // The pg pool is lazy, so constructing the service never touches a database.
    service = new PrismaService(configService);
  });

  describe('isHealthy', () => {
    it('returns true when SELECT 1 succeeds', async () => {
      jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);

      await expect(service.isHealthy()).resolves.toBe(true);
    });

    it('returns false instead of throwing when the database is unreachable', async () => {
      jest.spyOn(service, '$queryRaw').mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(service.isHealthy()).resolves.toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('connects on module init and disconnects on destroy', async () => {
      const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
      const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(connect).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });
});

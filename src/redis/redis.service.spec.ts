import Redis from 'ioredis';
import { REDIS_HEALTH_TIMEOUT_MS } from './redis.constants';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let client: jest.Mocked<Pick<Redis, 'ping' | 'quit'>>;
  let service: RedisService;

  beforeEach(() => {
    client = {
      ping: jest.fn(),
      quit: jest.fn(),
    };
    service = new RedisService(client as unknown as Redis);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isHealthy', () => {
    it('returns true when Redis answers PONG', async () => {
      client.ping.mockResolvedValue('PONG');

      await expect(service.isHealthy()).resolves.toBe(true);
    });

    it('returns false when the client rejects', async () => {
      client.ping.mockRejectedValue(new Error('Connection is closed'));

      await expect(service.isHealthy()).resolves.toBe(false);
    });

    it('returns false when the PING never resolves within the timeout', async () => {
      jest.useFakeTimers();
      client.ping.mockReturnValue(new Promise<'PONG'>(() => undefined));

      const result = service.isHealthy();
      await jest.advanceTimersByTimeAsync(REDIS_HEALTH_TIMEOUT_MS + 1);

      await expect(result).resolves.toBe(false);
    });
  });

  it('closes the connection on module destroy', async () => {
    client.quit.mockResolvedValue('OK');

    await service.onModuleDestroy();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('exposes the underlying client for modules that need raw commands', () => {
    expect(service.connection).toBe(client);
  });
});

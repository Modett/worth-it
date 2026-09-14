import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_HEALTH_TIMEOUT_MS } from './redis.constants';

/**
 * Thin wrapper over the shared ioredis client. Feature modules should depend
 * on this service (or the REDIS_CLIENT token) rather than instantiating their
 * own connections, so the process keeps a predictable connection count.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  get connection(): Redis {
    return this.client;
  }

  async isHealthy(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Redis PING exceeded ${REDIS_HEALTH_TIMEOUT_MS}ms`)),
        REDIS_HEALTH_TIMEOUT_MS,
      );
    });

    try {
      const reply = await Promise.race([this.client.ping(), timeout]);
      return reply === 'PONG';
    } catch {
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}

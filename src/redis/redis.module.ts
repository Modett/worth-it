import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EnvironmentVariables } from '../config/env.validation';
import { parseRedisUrl } from './redis-options';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

/**
 * Shared Redis infrastructure: one ioredis client for caching / rate limiting
 * and the BullMQ root connection for background queues. Feature modules add
 * their own queues with `BullModule.registerQueue(...)`.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => ({
        connection: {
          ...parseRedisUrl(configService.get('REDIS_URL', { infer: true })),
          // Required by BullMQ workers so blocking commands are never
          // abandoned mid-wait during a reconnect.
          maxRetriesPerRequest: null,
        },
      }),
    }),
  ],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService<EnvironmentVariables, true>) => {
        const client = new Redis({
          ...parseRedisUrl(configService.get('REDIS_URL', { infer: true })),
          lazyConnect: true,
        });
        // Connect eagerly so an unreachable Redis fails the boot rather than
        // the first request that needs it.
        await client.connect();
        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}

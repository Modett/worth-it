import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { seconds, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { createValidationPipe } from './common/pipes/validation-pipe.factory';
import { AppConfigModule } from './config/app-config.module';
import { EnvironmentVariables } from './config/env.validation';
import { LoggingModule } from './logging/logging.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { REDIS_CLIENT } from './redis/redis.constants';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>, redis: Redis) => ({
        throttlers: [
          {
            ttl: seconds(configService.get('THROTTLE_TTL_SECONDS', { infer: true })),
            limit: configService.get('THROTTLE_LIMIT', { infer: true }),
          },
        ],
        // Counters live in Redis so limits hold across replicas (.cursorrules §2).
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: rate limiting runs first so a flood of unauthenticated
    // requests is cut off before spending CPU on signature verification.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Authentication is the default for every route; @Public() is the opt-out
    // (.cursorrules §5).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

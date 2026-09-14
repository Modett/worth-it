import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { EnvironmentVariables } from '../config/env.validation';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Single shared PrismaClient for the process. The `pg` pool behind the
 * adapter is capped by DATABASE_POOL_MAX so that
 * `replicas * DATABASE_POOL_MAX` stays under the Railway Postgres limit.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    const adapter = new PrismaPg({
      connectionString: configService.get('DATABASE_URL', { infer: true }),
      max: configService.get('DATABASE_POOL_MAX', { infer: true }),
    });

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    // Connect eagerly so a bad DATABASE_URL fails the boot, not the first request.
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap liveness probe used by the health endpoint. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

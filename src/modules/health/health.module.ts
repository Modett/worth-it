import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

// PrismaModule and RedisModule are @Global, so their services are already
// injectable here without re-importing.
@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

// PrismaModule is @Global, so PrismaService needs no import here. The items
// module is not imported: this module looks up the item itself (404-not-403)
// rather than asking ItemsService, so the dependency stays one-way for step 7
// (Pauses will import ScoringService / pauseHoursForPrice, not the reverse).
@Module({
  controllers: [ScoringController],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class ScoringModule {}

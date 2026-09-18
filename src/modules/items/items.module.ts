import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../../storage/storage.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { ScreenshotService } from './screenshot.service';

@Module({
  imports: [AiModule, StorageModule],
  controllers: [ItemsController],
  providers: [ItemsService, ScreenshotService],
  exports: [ItemsService],
})
export class ItemsModule {}

import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { OBJECT_STORAGE, S3_CLIENT } from './object-storage.constants';
import { R2ObjectStorageService } from './r2-object-storage.service';
import { STORAGE_CONFIG } from './storage.config';

@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) =>
        new S3Client({
          region: STORAGE_CONFIG.region,
          endpoint: configService.get('R2_ENDPOINT', { infer: true }),
          credentials: {
            accessKeyId: configService.get('R2_ACCESS_KEY', { infer: true }),
            secretAccessKey: configService.get('R2_SECRET_KEY', { infer: true }),
          },
        }),
    },
    {
      provide: OBJECT_STORAGE,
      useClass: R2ObjectStorageService,
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}

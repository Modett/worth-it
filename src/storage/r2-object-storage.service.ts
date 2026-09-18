import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { S3_CLIENT } from './object-storage.constants';
import { ObjectStorageService, ObjectStorageUploadInput } from './object-storage.interface';

@Injectable()
export class R2ObjectStorageService implements ObjectStorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async upload(input: ObjectStorageUploadInput): Promise<{ url: string }> {
    const bucket = this.configService.get('R2_BUCKET', { infer: true });

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.mimeType,
        ContentLength: input.body.length,
      }),
    );

    return {
      url: publicObjectUrl(
        this.configService.get('R2_PUBLIC_BASE_URL', { infer: true }),
        input.key,
      ),
    };
  }
}

export function publicObjectUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
}

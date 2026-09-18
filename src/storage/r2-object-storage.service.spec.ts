import { PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EnvironmentVariables } from '../config/env.validation';
import { S3_CLIENT } from './object-storage.constants';
import { publicObjectUrl, R2ObjectStorageService } from './r2-object-storage.service';

describe('R2ObjectStorageService', () => {
  it('uploads under the given key and returns the public URL', async () => {
    const send = jest.fn().mockResolvedValue({});
    const configService = {
      get: jest.fn((key: keyof EnvironmentVariables) => {
        const values: Partial<Record<keyof EnvironmentVariables, string>> = {
          R2_BUCKET: 'worth-it-test',
          R2_PUBLIC_BASE_URL: 'https://cdn.example.test/',
        };
        return values[key];
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        R2ObjectStorageService,
        { provide: S3_CLIENT, useValue: { send } },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const service = moduleRef.get(R2ObjectStorageService);
    const body = Buffer.from('image-bytes');

    const result = await service.upload({
      key: 'users/abc/screenshots/shot.jpg',
      body,
      mimeType: 'image/jpeg',
    });

    expect(send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
    const [[command]] = send.mock.calls as [[PutObjectCommand]];
    expect(command.input).toMatchObject({
      Bucket: 'worth-it-test',
      Key: 'users/abc/screenshots/shot.jpg',
      ContentType: 'image/jpeg',
      ContentLength: body.length,
    });
    expect(result.url).toBe('https://cdn.example.test/users/abc/screenshots/shot.jpg');
  });
});

describe('publicObjectUrl', () => {
  it('joins without doubling slashes', () => {
    expect(publicObjectUrl('https://cdn.example.test/', '/users/a/shot.jpg')).toBe(
      'https://cdn.example.test/users/a/shot.jpg',
    );
  });
});

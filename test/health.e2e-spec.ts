import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, NEST_FACTORY_OPTIONS } from '../src/app.setup';
import { ErrorResponse } from '../src/common/filters/error-response.interface';
import { HealthResponseDto } from '../src/modules/health/dto/health-response.dto';

describe('GET /api/v1/health (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(NEST_FACTORY_OPTIONS),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with db and redis reporting ok against real services', async () => {
    const response = await request(server).get('/api/v1/health').expect(200);

    const body = response.body as HealthResponseDto;
    expect(body).toEqual({
      status: 'ok',
      db: 'ok',
      redis: 'ok',
      timestamp: expect.any(String) as string,
    });
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('is reachable without an Authorization header', async () => {
    await request(server).get('/api/v1/health').unset('Authorization').expect(200);
  });

  it('serves the Swagger document at /api/docs', async () => {
    const response = await request(server).get('/api/docs-json').expect(200);

    const document = response.body as { paths: Record<string, unknown> };
    expect(document.paths).toHaveProperty('/api/v1/health');
  });

  it('returns the standard error shape for unknown routes', async () => {
    const response = await request(server).get('/api/v1/does-not-exist').expect(404);

    expect(response.body as ErrorResponse).toEqual({
      statusCode: 404,
      message: expect.any(String) as string,
      error: 'Not Found',
      timestamp: expect.any(String) as string,
      path: '/api/v1/does-not-exist',
    });
  });
});

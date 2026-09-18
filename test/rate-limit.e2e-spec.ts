import { Controller, Get, INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle } from '@nestjs/throttler';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, NEST_FACTORY_OPTIONS } from '../src/app.setup';
import { Public } from '../src/common/decorators/public.decorator';
import { ErrorResponse } from '../src/common/filters/error-response.interface';

const PROBE_LIMIT = 3;
const PROBE_TTL_MS = 60_000;

// Registered only for this suite, to exercise the Redis-backed throttler in
// isolation from any real endpoint's own limit.
//
// @Public() was added when the auth module made JwtAuthGuard global: this
// route used to need no token, and now everything does unless it opts out.
// The assertions below are unchanged — see ProtectedProbeController for the
// test that the new default actually bites.
@Controller('throttle-probe')
class ThrottleProbeController {
  @Get()
  @Public()
  @Throttle({ default: { limit: PROBE_LIMIT, ttl: PROBE_TTL_MS } })
  probe(): { ok: true } {
    return { ok: true };
  }
}

/** Identical, minus the @Public() opt-out. */
@Controller('protected-probe')
class ProtectedProbeController {
  @Get()
  probe(): { ok: true } {
    return { ok: true };
  }
}

describe('Redis-backed rate limiting (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrottleProbeController, ProtectedProbeController],
    }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(NEST_FACTORY_OPTIONS),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows requests up to the limit and rejects the next with a 429 in the standard shape', async () => {
    // A unique forwarded IP isolates this run's counter from previous runs
    // sharing the same Redis database.
    const clientIp = `10.${randomInt()}.${randomInt()}.${randomInt()}`;
    const probe = () =>
      request(server).get('/api/v1/throttle-probe').set('X-Forwarded-For', clientIp);

    for (let attempt = 1; attempt <= PROBE_LIMIT; attempt += 1) {
      const response = await probe().expect(200);
      expect(response.headers['x-ratelimit-limit']).toBe(String(PROBE_LIMIT));
      expect(response.headers['x-ratelimit-remaining']).toBe(String(PROBE_LIMIT - attempt));
    }

    const rejected = await probe().expect(429);
    expect(rejected.headers['retry-after']).toBeDefined();
    expect(rejected.body as ErrorResponse).toEqual({
      statusCode: 429,
      message: expect.any(String) as string,
      error: 'Too Many Requests',
      timestamp: expect.any(String) as string,
      path: '/api/v1/throttle-probe',
    });
  });

  it('leaves the health endpoint unthrottled', async () => {
    for (let attempt = 0; attempt < PROBE_LIMIT + 2; attempt += 1) {
      await request(server).get('/api/v1/health').expect(200);
    }
  });

  it('now requires a token on a route that has not opted out of authentication', async () => {
    const response = await request(server).get('/api/v1/protected-probe').expect(401);

    expect(response.body as ErrorResponse).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
      path: '/api/v1/protected-probe',
    });
  });
});

function randomInt(): number {
  return Number.parseInt(randomUUID().slice(0, 2), 16);
}

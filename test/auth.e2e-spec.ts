import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ErrorResponse } from '../src/common/filters/error-response.interface';
import { AUTH_CONFIG } from '../src/modules/auth/auth.config';
import { AuthTokensDto } from '../src/modules/auth/dto/auth-tokens.dto';
import { SignupResponseDto } from '../src/modules/auth/dto/signup-response.dto';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prismaService: PrismaService;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prismaService = app.get(PrismaService);
    // Used to mint deliberately invalid tokens without duplicating the secret.
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** A fresh address per test keeps runs independent of each other. */
  function uniqueEmail(): string {
    return `shopper-${randomUUID()}@example.com`;
  }

  /**
   * Signup and login are throttled to 5/minute per IP, so each test presents a
   * unique client address rather than exhausting a shared budget.
   */
  function uniqueClientIp(): string {
    const octet = (): number => 1 + Math.floor(Math.random() * 254);
    return `10.${octet()}.${octet()}.${octet()}`;
  }

  async function signup(email: string, ip = uniqueClientIp()): Promise<SignupResponseDto> {
    const response = await request(server)
      .post('/api/v1/auth/signup')
      .set('X-Forwarded-For', ip)
      .send({ email, password: PASSWORD })
      .expect(201);

    return response.body as SignupResponseDto;
  }

  async function login(email: string, ip = uniqueClientIp()): Promise<AuthTokensDto> {
    const response = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password: PASSWORD })
      .expect(200);

    return response.body as AuthTokensDto;
  }

  function refresh(refreshToken: string): request.Test {
    return request(server).post('/api/v1/auth/refresh').send({ refreshToken });
  }

  function session(accessToken: string): request.Test {
    return request(server)
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${accessToken}`);
  }

  describe('the happy path, end to end', () => {
    it('carries a user from signup through login, a protected call, refresh and logout', async () => {
      const email = uniqueEmail();

      // 1. Signup returns the new account without any token or secret.
      const created = await signup(email);
      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        email,
        createdAt: expect.any(String) as string,
      });
      expect(JSON.stringify(created)).not.toContain(PASSWORD);

      // 2. Login mints the token pair.
      const tokens = await login(email);
      expect(tokens).toEqual({
        accessToken: expect.any(String) as string,
        refreshToken: expect.any(String) as string,
        tokenType: 'Bearer',
        expiresIn: AUTH_CONFIG.accessTokenTtlSeconds,
      });

      // 3. The access token opens a protected route, and @CurrentUser()
      //    resolves to the user that signed up.
      const protectedResponse = await session(tokens.accessToken).expect(200);
      expect(protectedResponse.body).toEqual({ userId: created.id });

      // 4. Refresh rotates the pair.
      const rotated = (await refresh(tokens.refreshToken).expect(200)).body as AuthTokensDto;
      expect(rotated.refreshToken).not.toBe(tokens.refreshToken);
      await session(rotated.accessToken).expect(200);

      // 5. The consumed refresh token is dead.
      await refresh(tokens.refreshToken).expect(401);

      // 6. Logout revokes the current refresh token.
      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: rotated.refreshToken })
        .expect(204);

      // 7. Which can no longer be exchanged.
      await refresh(rotated.refreshToken).expect(401);
    });

    it('stores only a hash of the refresh token, never the token itself', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = await login(email);

      const rows = await prismaService.refreshToken.findMany({
        where: { userId: created.id },
        select: { tokenHash: true, revokedAt: true, replacedByTokenHash: true },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].tokenHash).not.toContain(tokens.refreshToken);
      expect(rows[0].revokedAt).toBeNull();
    });

    it('records the rotation chain when a token is refreshed', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = await login(email);

      await refresh(tokens.refreshToken).expect(200);

      const rows = await prismaService.refreshToken.findMany({
        where: { userId: created.id },
        orderBy: { createdAt: 'asc' },
        select: { tokenHash: true, revokedAt: true, replacedByTokenHash: true },
      });

      expect(rows).toHaveLength(2);
      const [original, replacement] = rows;
      expect(original.revokedAt).not.toBeNull();
      expect(original.replacedByTokenHash).toBe(replacement.tokenHash);
      expect(replacement.revokedAt).toBeNull();
    });

    it('defaults the onboarding fields so the users module can fill them in later', async () => {
      const created = await signup(uniqueEmail());

      const user = await prismaService.user.findUniqueOrThrow({
        where: { id: created.id },
        select: { currency: true, monthlyBudget: true, defaultPauseHours: true },
      });

      expect(user.currency).toBe('USD');
      expect(Number(user.monthlyBudget)).toBe(500);
      expect(user.defaultPauseHours).toBe(24);
    });
  });

  describe('signup', () => {
    it('rejects a duplicate email with a 409 that carries no Prisma detail', async () => {
      const email = uniqueEmail();
      await signup(email);

      const response = await request(server)
        .post('/api/v1/auth/signup')
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ email, password: PASSWORD })
        .expect(409);

      const body = response.body as ErrorResponse;
      expect(body).toEqual({
        statusCode: 409,
        message: 'An account with this email already exists',
        error: 'Conflict',
        timestamp: expect.any(String) as string,
        path: '/api/v1/auth/signup',
      });
      expect(JSON.stringify(body)).not.toMatch(/prisma|constraint|users_email_key/i);
    });

    it('treats the email case-insensitively when detecting duplicates', async () => {
      const email = uniqueEmail();
      await signup(email);

      await request(server)
        .post('/api/v1/auth/signup')
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ email: email.toUpperCase(), password: PASSWORD })
        .expect(409);
    });

    it.each([
      ['a malformed email', { email: 'not-an-email', password: PASSWORD }],
      ['a password under the minimum length', { email: 'shopper@example.com', password: 'short' }],
      ['a missing password', { email: 'shopper@example.com' }],
    ])('rejects %s with a 400', async (_case, payload) => {
      const response = await request(server)
        .post('/api/v1/auth/signup')
        .set('X-Forwarded-For', uniqueClientIp())
        .send(payload)
        .expect(400);

      expect((response.body as ErrorResponse).error).toBe('Bad Request');
    });

    it('rejects unknown properties rather than silently ignoring them', async () => {
      await request(server)
        .post('/api/v1/auth/signup')
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ email: uniqueEmail(), password: PASSWORD, isAdmin: true })
        .expect(400);
    });
  });

  describe('login', () => {
    it('returns the same generic error for a wrong password and an unknown email', async () => {
      const email = uniqueEmail();
      await signup(email);

      const wrongPassword = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ email, password: 'not-the-password' })
        .expect(401);

      const unknownEmail = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ email: uniqueEmail(), password: PASSWORD })
        .expect(401);

      expect((wrongPassword.body as ErrorResponse).message).toBe(
        (unknownEmail.body as ErrorResponse).message,
      );
      expect(wrongPassword.body as ErrorResponse).toMatchObject({
        statusCode: 401,
        message: 'Invalid email or password',
        error: 'Unauthorized',
      });
    });

    it('accepts the email in any case', async () => {
      const email = uniqueEmail();
      await signup(email);

      await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', uniqueClientIp())
        .send({ email: email.toUpperCase(), password: PASSWORD })
        .expect(200);
    });

    it('stops credential stuffing at the sixth login within the window', async () => {
      const attacker = uniqueClientIp();
      const email = uniqueEmail();
      await signup(email);

      for (let attempt = 1; attempt <= AUTH_CONFIG.credentialThrottle.limit; attempt += 1) {
        await request(server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', attacker)
          .send({ email, password: `guess-${attempt}` })
          .expect(401);
      }

      const throttled = await request(server)
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', attacker)
        .send({ email, password: PASSWORD })
        .expect(429);

      expect(throttled.body as ErrorResponse).toMatchObject({
        statusCode: 429,
        error: 'Too Many Requests',
        path: '/api/v1/auth/login',
      });

      // The limit is per IP, so a different client is unaffected.
      await login(email);
    });
  });

  describe('refresh token reuse detection', () => {
    it('revokes every live session for the user when a consumed token is replayed', async () => {
      const email = uniqueEmail();
      const created = await signup(email);

      // Two independent sessions, as if the user were signed in on a phone
      // and a tablet.
      const stolen = await login(email);
      const otherDevice = await login(email);

      // The attacker (or the user) rotates the stolen token once, legitimately.
      const rotated = (await refresh(stolen.refreshToken).expect(200)).body as AuthTokensDto;

      // Replaying the already-consumed token is the theft signal.
      await refresh(stolen.refreshToken).expect(401);

      // Every refresh token for the user is now dead, including the rotation's
      // own output and the unrelated device's session.
      await refresh(rotated.refreshToken).expect(401);
      await refresh(otherDevice.refreshToken).expect(401);

      const live = await prismaService.refreshToken.count({
        where: { userId: created.id, revokedAt: null },
      });
      expect(live).toBe(0);

      // The user recovers by logging in again.
      const recovered = await login(email);
      await session(recovered.accessToken).expect(200);
    });

    it('rejects a refresh token that was never issued', async () => {
      const response = await refresh('definitely-not-a-real-token').expect(401);

      expect(response.body as ErrorResponse).toMatchObject({
        statusCode: 401,
        message: 'Invalid or expired refresh token',
        error: 'Unauthorized',
      });
    });

    it('rejects an expired refresh token', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = await login(email);

      // Backdate the stored expiry rather than waiting 30 days.
      await prismaService.refreshToken.updateMany({
        where: { userId: created.id, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await refresh(tokens.refreshToken).expect(401);
    });

    it('is idempotent on logout, so a retried logout still succeeds', async () => {
      const email = uniqueEmail();
      await signup(email);
      const tokens = await login(email);

      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(204);
      await request(server)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(204);
    });
  });

  describe('authentication is the default', () => {
    it('rejects a protected route with no token, in the standard error shape', async () => {
      const response = await request(server).get('/api/v1/auth/session').expect(401);

      expect(response.body as ErrorResponse).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
        timestamp: expect.any(String) as string,
        path: '/api/v1/auth/session',
      });
    });

    it('rejects a malformed token', async () => {
      await session('not-a-jwt').expect(401);
    });

    it('rejects a well-formed token signed with a different secret', async () => {
      const forged = await jwtService.signAsync(
        { sub: randomUUID() },
        { secret: 'a-different-secret-long-enough-to-pass-x' },
      );

      await session(forged).expect(401);
    });

    it('rejects an expired token even though the signature is valid', async () => {
      const expired = await jwtService.signAsync({ sub: randomUUID() }, { expiresIn: '-1m' });

      await session(expired).expect(401);
    });

    it('ignores a token presented in the wrong scheme', async () => {
      const email = uniqueEmail();
      await signup(email);
      const tokens = await login(email);

      await request(server)
        .get('/api/v1/auth/session')
        .set('Authorization', `Basic ${tokens.accessToken}`)
        .expect(401);
    });

    it('still serves @Public() routes unauthenticated', async () => {
      await request(server).get('/api/v1/health').expect(200);
      await request(server).get('/api/docs-json').expect(200);
    });

    it('documents the auth routes in Swagger', async () => {
      const response = await request(server).get('/api/docs-json').expect(200);

      const document = response.body as { paths: Record<string, unknown> };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining([
          '/api/v1/auth/signup',
          '/api/v1/auth/login',
          '/api/v1/auth/refresh',
          '/api/v1/auth/logout',
          '/api/v1/auth/session',
        ]),
      );
    });
  });
});

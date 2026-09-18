import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, NEST_FACTORY_OPTIONS } from '../src/app.setup';
import { ErrorResponse } from '../src/common/filters/error-response.interface';
import { AuthTokensDto } from '../src/modules/auth/dto/auth-tokens.dto';
import { SignupResponseDto } from '../src/modules/auth/dto/signup-response.dto';
import { UserResponseDto } from '../src/modules/users/dto/user-response.dto';
import { USERS_CONFIG } from '../src/modules/users/users.config';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-brand-new-secret';

/** Signup defaults the onboarding fields; the users module edits them. */
const DEFAULT_PROFILE = {
  currency: 'USD',
  monthlyBudget: 500,
  defaultPauseHours: 24,
};

describe('Users (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prismaService: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(NEST_FACTORY_OPTIONS),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prismaService = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function uniqueEmail(): string {
    return `shopper-${randomUUID()}@example.com`;
  }

  /**
   * Signup, login and the two password-confirming endpoints are throttled per
   * IP, so every call presents a unique client address rather than sharing one
   * budget across the suite.
   */
  function uniqueClientIp(): string {
    const octet = (): number => 1 + Math.floor(Math.random() * 254);
    return `10.${octet()}.${octet()}.${octet()}`;
  }

  async function signup(email: string): Promise<SignupResponseDto> {
    const response = await request(server)
      .post('/api/v1/auth/signup')
      .set('X-Forwarded-For', uniqueClientIp())
      .send({ email, password: PASSWORD })
      .expect(201);

    return response.body as SignupResponseDto;
  }

  function login(email: string, password = PASSWORD): request.Test {
    return request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', uniqueClientIp())
      .send({ email, password });
  }

  async function signupAndLogin(email: string): Promise<AuthTokensDto> {
    await signup(email);
    const response = await login(email).expect(200);
    return response.body as AuthTokensDto;
  }

  function getProfile(accessToken: string): request.Test {
    return request(server).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);
  }

  function patchProfile(accessToken: string, body: Record<string, unknown>): request.Test {
    return request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  function changePassword(
    accessToken: string,
    body: Record<string, unknown>,
    ip = uniqueClientIp(),
  ): request.Test {
    return request(server)
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Forwarded-For', ip)
      .send(body);
  }

  function deleteAccount(
    accessToken: string,
    body: Record<string, unknown>,
    ip = uniqueClientIp(),
  ): request.Test {
    return request(server)
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Forwarded-For', ip)
      .send(body);
  }

  function refresh(refreshToken: string): request.Test {
    return request(server).post('/api/v1/auth/refresh').send({ refreshToken });
  }

  describe('the account lifecycle, end to end', () => {
    it('carries a user from signup through onboarding, a password change and deletion', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;

      // 1. A fresh account reports the signup defaults and nothing secret.
      const profile = (await getProfile(tokens.accessToken).expect(200)).body as UserResponseDto;
      expect(profile).toEqual({
        id: created.id,
        email,
        ...DEFAULT_PROFILE,
        createdAt: expect.any(String) as string,
      });

      // 2. Onboarding sets the real preferences.
      const updated = (
        await patchProfile(tokens.accessToken, {
          currency: 'GBP',
          monthlyBudget: 750.5,
          defaultPauseHours: 48,
        }).expect(200)
      ).body as UserResponseDto;
      expect(updated).toMatchObject({
        currency: 'GBP',
        monthlyBudget: 750.5,
        defaultPauseHours: 48,
      });

      // 3. And they persist for the next read.
      const reread = (await getProfile(tokens.accessToken).expect(200)).body as UserResponseDto;
      expect(reread).toEqual(updated);

      // 4. A password change needs the current password to be right.
      await changePassword(tokens.accessToken, {
        currentPassword: 'not-the-password',
        newPassword: NEW_PASSWORD,
      }).expect(403);

      await changePassword(tokens.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);

      // 5. Every session is gone: the refresh token from before the change is
      //    dead, and the old password no longer logs in.
      await refresh(tokens.refreshToken).expect(401);
      await login(email).expect(401);

      const reauthenticated = (await login(email, NEW_PASSWORD).expect(200)).body as AuthTokensDto;

      // 6. Deletion is held to the same bar as the password change.
      await deleteAccount(reauthenticated.accessToken, {
        currentPassword: PASSWORD,
      }).expect(403);
      await expect(prismaService.user.count({ where: { id: created.id } })).resolves.toBe(1);

      await deleteAccount(reauthenticated.accessToken, {
        currentPassword: NEW_PASSWORD,
      }).expect(204);

      // 7. The account is unusable and its dependent rows went with it.
      await login(email, NEW_PASSWORD).expect(401);
      await expect(prismaService.user.count({ where: { id: created.id } })).resolves.toBe(0);
      await expect(
        prismaService.refreshToken.count({ where: { userId: created.id } }),
      ).resolves.toBe(0);
    });
  });

  describe('GET /users/me', () => {
    it('returns only the six documented fields, never the password hash', async () => {
      const email = uniqueEmail();
      const tokens = await signupAndLogin(email);

      const response = await getProfile(tokens.accessToken).expect(200);

      expect(Object.keys(response.body as UserResponseDto).sort()).toEqual([
        'createdAt',
        'currency',
        'defaultPauseHours',
        'email',
        'id',
        'monthlyBudget',
      ]);
      expect(JSON.stringify(response.body)).not.toMatch(/\$2[aby]\$/); // no bcrypt hash
    });

    it('scopes the response to the caller, not to whoever the client names', async () => {
      const other = await signup(uniqueEmail());
      const mine = await signupAndLogin(uniqueEmail());

      const response = await getProfile(mine.accessToken).expect(200);

      expect((response.body as UserResponseDto).id).not.toBe(other.id);
    });
  });

  describe('PATCH /users/me', () => {
    it.each([
      ['currency', { currency: 'EUR' }],
      ['monthlyBudget', { monthlyBudget: 1234.56 }],
      ['defaultPauseHours', { defaultPauseHours: USERS_CONFIG.defaultPauseHours.max }],
    ])('updates %s on its own and leaves the rest at their defaults', async (_field, body) => {
      const tokens = await signupAndLogin(uniqueEmail());

      const response = await patchProfile(tokens.accessToken, body).expect(200);

      expect(response.body as UserResponseDto).toMatchObject({ ...DEFAULT_PROFILE, ...body });
    });

    it.each([
      ['a lower-case currency', { currency: 'gbp' }],
      ['a currency that is not three letters', { currency: 'POUND' }],
      ['a zero budget', { monthlyBudget: 0 }],
      ['a negative budget', { monthlyBudget: -100 }],
      ['a budget above the ceiling', { monthlyBudget: USERS_CONFIG.monthlyBudget.max + 1 }],
      ['a budget with sub-cent precision', { monthlyBudget: 10.123 }],
      ['a pause of zero hours', { defaultPauseHours: 0 }],
      ['a pause longer than a week', { defaultPauseHours: USERS_CONFIG.defaultPauseHours.max + 1 }],
      ['a fractional pause', { defaultPauseHours: 1.5 }],
    ])('rejects %s with a 400', async (_case, body) => {
      const tokens = await signupAndLogin(uniqueEmail());

      const response = await patchProfile(tokens.accessToken, body).expect(400);

      expect((response.body as ErrorResponse).error).toBe('Bad Request');
    });

    it('rejects an attempt to patch a field that is not a preference', async () => {
      const tokens = await signupAndLogin(uniqueEmail());

      await patchProfile(tokens.accessToken, { email: 'attacker@example.com' }).expect(400);
      await patchProfile(tokens.accessToken, { passwordHash: 'anything' }).expect(400);
    });

    it('stores the budget with cents intact', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;

      await patchProfile(tokens.accessToken, { monthlyBudget: 1234.56 }).expect(200);

      const stored = await prismaService.user.findUniqueOrThrow({
        where: { id: created.id },
        select: { monthlyBudget: true },
      });
      expect(stored.monthlyBudget.toFixed(2)).toBe('1234.56');
    });
  });

  describe('PATCH /users/me/password', () => {
    it('revokes every session for the user, on every device', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const phone = (await login(email).expect(200)).body as AuthTokensDto;
      const tablet = (await login(email).expect(200)).body as AuthTokensDto;

      await changePassword(phone.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);

      await refresh(phone.refreshToken).expect(401);
      await refresh(tablet.refreshToken).expect(401);
      await expect(
        prismaService.refreshToken.count({ where: { userId: created.id, revokedAt: null } }),
      ).resolves.toBe(0);
    });

    it('leaves the stored hash untouched when the current password is wrong', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;
      const before = await storedPasswordHash(created.id);

      const response = await changePassword(tokens.accessToken, {
        currentPassword: 'not-the-password',
        newPassword: NEW_PASSWORD,
      }).expect(403);

      expect(response.body as ErrorResponse).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
        path: '/api/v1/users/me/password',
      });
      await expect(storedPasswordHash(created.id)).resolves.toBe(before);
      // The rejection must not cost the user their other sessions.
      await refresh(tokens.refreshToken).expect(200);
    });

    it('stores a new hash rather than the password itself', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;
      const before = await storedPasswordHash(created.id);

      await changePassword(tokens.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);

      const after = await storedPasswordHash(created.id);
      expect(after).not.toBe(before);
      expect(after).not.toContain(NEW_PASSWORD);
      expect(after).toMatch(/^\$2[aby]\$/);
    });

    it.each([
      [
        'a new password under the minimum length',
        { currentPassword: PASSWORD, newPassword: 'short' },
      ],
      [
        'a new password identical to the current one',
        { currentPassword: PASSWORD, newPassword: PASSWORD },
      ],
      ['a missing current password', { newPassword: NEW_PASSWORD }],
      ['a missing new password', { currentPassword: PASSWORD }],
    ])('rejects %s with a 400', async (_case, body) => {
      const tokens = await signupAndLogin(uniqueEmail());

      await changePassword(tokens.accessToken, body).expect(400);
    });

    it('throttles repeated guesses from one client', async () => {
      const attacker = uniqueClientIp();
      const tokens = await signupAndLogin(uniqueEmail());

      for (
        let attempt = 1;
        attempt <= USERS_CONFIG.passwordConfirmationThrottle.limit;
        attempt += 1
      ) {
        await changePassword(
          tokens.accessToken,
          { currentPassword: `guess-${attempt}`, newPassword: NEW_PASSWORD },
          attacker,
        ).expect(403);
      }

      await changePassword(
        tokens.accessToken,
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        attacker,
      ).expect(429);
    });
  });

  describe('DELETE /users/me', () => {
    it('takes the dependent rows with the user, not just the user row', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      // Two logins so there are refresh tokens to cascade away.
      const first = (await login(email).expect(200)).body as AuthTokensDto;
      await login(email).expect(200);
      await expect(
        prismaService.refreshToken.count({ where: { userId: created.id } }),
      ).resolves.toBe(2);

      await deleteAccount(first.accessToken, { currentPassword: PASSWORD }).expect(204);

      await expect(prismaService.user.count({ where: { id: created.id } })).resolves.toBe(0);
      await expect(
        prismaService.refreshToken.count({ where: { userId: created.id } }),
      ).resolves.toBe(0);
    });

    it('keeps the account when the confirmation password is wrong', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;

      await deleteAccount(tokens.accessToken, { currentPassword: 'not-the-password' }).expect(403);

      await expect(prismaService.user.count({ where: { id: created.id } })).resolves.toBe(1);
      await login(email).expect(200);
    });

    it('rejects a deletion with no confirmation password at all', async () => {
      const email = uniqueEmail();
      const created = await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;

      await deleteAccount(tokens.accessToken, {}).expect(400);

      await expect(prismaService.user.count({ where: { id: created.id } })).resolves.toBe(1);
    });

    it('leaves a still-valid access token with nothing to act on afterwards', async () => {
      const email = uniqueEmail();
      await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;

      await deleteAccount(tokens.accessToken, { currentPassword: PASSWORD }).expect(204);

      // The JWT is stateless, so it still verifies for its remaining lifetime;
      // the user behind it is gone, which is a 404 rather than a 500.
      await getProfile(tokens.accessToken).expect(404);
    });
  });

  describe('authentication is required on every users route', () => {
    it.each([
      ['GET', '/api/v1/users/me', {}],
      ['PATCH', '/api/v1/users/me', { currency: 'GBP' }],
      [
        'PATCH',
        '/api/v1/users/me/password',
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      ],
      ['DELETE', '/api/v1/users/me', { currentPassword: PASSWORD }],
    ] as const)('rejects an unauthenticated %s %s with a 401', async (method, path, body) => {
      const response = await request(server)
        [method.toLowerCase() as 'get' | 'patch' | 'delete'](path)
        .set('X-Forwarded-For', uniqueClientIp())
        .send(body)
        .expect(401);

      expect(response.body as ErrorResponse).toEqual({
        statusCode: 401,
        message: 'Unauthorized',
        error: 'Unauthorized',
        timestamp: expect.any(String) as string,
        path,
      });
    });

    it('rejects a token signed for a user that no longer exists', async () => {
      const email = uniqueEmail();
      await signup(email);
      const tokens = (await login(email).expect(200)).body as AuthTokensDto;
      await deleteAccount(tokens.accessToken, { currentPassword: PASSWORD }).expect(204);

      await patchProfile(tokens.accessToken, { currency: 'GBP' }).expect(404);
    });

    it('documents the users routes in Swagger', async () => {
      const response = await request(server).get('/api/docs-json').expect(200);

      const document = response.body as { paths: Record<string, unknown> };
      expect(Object.keys(document.paths)).toEqual(
        expect.arrayContaining(['/api/v1/users/me', '/api/v1/users/me/password']),
      );
    });
  });

  async function storedPasswordHash(userId: string): Promise<string> {
    const user = await prismaService.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });
    return user.passwordHash;
  }
});

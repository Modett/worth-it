import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_CONFIG, MILLISECONDS_PER_DAY } from './auth.config';
import { AuthService } from './auth.service';
import {
  EmailAlreadyRegisteredException,
  InvalidCredentialsException,
  InvalidRefreshTokenException,
} from './exceptions/auth.exceptions';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCESS_TOKEN = 'signed.access.token';
const RAW_REFRESH_TOKEN = 'raw-refresh-token';

interface RefreshTokenRow {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

describe('AuthService', () => {
  let service: AuthService;
  let userDelegate: { create: jest.Mock; findUnique: jest.Mock };
  let refreshTokenDelegate: { create: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock };
  let transactionClient: { refreshToken: typeof refreshTokenDelegate };
  let passwordService: { hash: jest.Mock; verify: jest.Mock; wasteComparison: jest.Mock };
  let tokenService: {
    signAccessToken: jest.Mock;
    generateRefreshToken: jest.Mock;
    hashRefreshToken: jest.Mock;
    revokeAllForUser: jest.Mock;
  };

  beforeEach(async () => {
    userDelegate = { create: jest.fn(), findUnique: jest.fn() };
    refreshTokenDelegate = { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() };
    transactionClient = { refreshToken: refreshTokenDelegate };

    const prismaService = {
      user: userDelegate,
      refreshToken: refreshTokenDelegate,
      // Interactive transactions run the callback against the same mock, and
      // a throw inside it propagates just as a real rollback would.
      $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
      ),
    };

    passwordService = {
      hash: jest.fn().mockResolvedValue('hashed-password'),
      verify: jest.fn(),
      wasteComparison: jest.fn().mockResolvedValue(undefined),
    };

    tokenService = {
      signAccessToken: jest.fn().mockResolvedValue(ACCESS_TOKEN),
      generateRefreshToken: jest.fn(),
      hashRefreshToken: jest.fn((token: string) => `sha256(${token})`),
      revokeAllForUser: jest.fn().mockResolvedValue(0),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaService },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubGeneratedRefreshToken(suffix = 'new'): {
    token: string;
    tokenHash: string;
    expiresAt: Date;
  } {
    // Token and hash are unrelated strings, mirroring a real digest, so tests
    // can assert the raw token never reaches the database.
    const generated = {
      token: `refresh-${suffix}`,
      tokenHash: `digest-${suffix}`,
      expiresAt: new Date(Date.now() + AUTH_CONFIG.refreshTokenTtlDays * MILLISECONDS_PER_DAY),
    };
    tokenService.generateRefreshToken.mockReturnValue(generated);
    return generated;
  }

  function storedRefreshToken(overrides: Partial<RefreshTokenRow> = {}): RefreshTokenRow {
    return {
      id: 'token-row-id',
      userId: USER_ID,
      expiresAt: new Date(Date.now() + MILLISECONDS_PER_DAY),
      revokedAt: null,
      ...overrides,
    };
  }

  describe('signup', () => {
    it('hashes the password with bcrypt and stores a normalised email', async () => {
      const createdAt = new Date('2026-09-13T10:00:00.000Z');
      userDelegate.create.mockResolvedValue({
        id: USER_ID,
        email: 'shopper@example.com',
        createdAt,
      });

      const result = await service.signup({
        email: '  Shopper@Example.COM ',
        password: 'correct-horse-battery',
      });

      expect(passwordService.hash).toHaveBeenCalledWith('correct-horse-battery');
      expect(userDelegate.create).toHaveBeenCalledWith({
        data: { email: 'shopper@example.com', passwordHash: 'hashed-password' },
        select: { id: true, email: true, createdAt: true },
      });
      expect(result).toEqual({
        id: USER_ID,
        email: 'shopper@example.com',
        createdAt: createdAt.toISOString(),
      });
    });

    it('never returns the password hash to the caller', async () => {
      userDelegate.create.mockResolvedValue({
        id: USER_ID,
        email: 'shopper@example.com',
        createdAt: new Date(),
      });

      const result = await service.signup({
        email: 'shopper@example.com',
        password: 'correct-horse-battery',
      });

      expect(JSON.stringify(result)).not.toContain('hashed-password');
    });

    it('rejects a duplicate email as a domain conflict rather than a Prisma error', async () => {
      userDelegate.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.signup({ email: 'taken@example.com', password: 'correct-horse-battery' }),
      ).rejects.toThrow(EmailAlreadyRegisteredException);
    });

    it('propagates unrelated database failures untouched', async () => {
      userDelegate.create.mockRejectedValue(new Error('connection terminated'));

      await expect(
        service.signup({ email: 'shopper@example.com', password: 'correct-horse-battery' }),
      ).rejects.toThrow('connection terminated');
    });
  });

  describe('login', () => {
    it('issues an access token and persists only the refresh token hash', async () => {
      userDelegate.findUnique.mockResolvedValue({ id: USER_ID, passwordHash: 'stored-hash' });
      passwordService.verify.mockResolvedValue(true);
      const generated = stubGeneratedRefreshToken();

      const result = await service.login({
        email: 'Shopper@example.com',
        password: 'correct-horse-battery',
      });

      expect(userDelegate.findUnique).toHaveBeenCalledWith({
        where: { email: 'shopper@example.com' },
        select: { id: true, passwordHash: true },
      });
      expect(result).toEqual({
        accessToken: ACCESS_TOKEN,
        refreshToken: generated.token,
        tokenType: 'Bearer',
        expiresIn: AUTH_CONFIG.accessTokenTtlSeconds,
      });

      expect(refreshTokenDelegate.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          tokenHash: generated.tokenHash,
          expiresAt: generated.expiresAt,
        },
      });
      const [[{ data }]] = refreshTokenDelegate.create.mock.calls as [[{ data: unknown }]];
      expect(JSON.stringify(data)).not.toContain(generated.token);
    });

    it('rejects a wrong password with the generic credentials error', async () => {
      userDelegate.findUnique.mockResolvedValue({ id: USER_ID, passwordHash: 'stored-hash' });
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'shopper@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(InvalidCredentialsException);
      expect(refreshTokenDelegate.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown email with the identical error, after an equalising hash comparison', async () => {
      userDelegate.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'correct-horse-battery' }),
      ).rejects.toThrow(InvalidCredentialsException);
      // Without this the response time would reveal that the email is unknown.
      expect(passwordService.wasteComparison).toHaveBeenCalledWith('correct-horse-battery');
    });

    it('gives wrong-password and unknown-email failures the same message', async () => {
      userDelegate.findUnique.mockResolvedValueOnce({ id: USER_ID, passwordHash: 'stored-hash' });
      passwordService.verify.mockResolvedValue(false);
      const wrongPassword = await service
        .login({ email: 'shopper@example.com', password: 'wrong' })
        .catch((error: Error) => error.message);

      userDelegate.findUnique.mockResolvedValueOnce(null);
      const unknownEmail = await service
        .login({ email: 'nobody@example.com', password: 'wrong' })
        .catch((error: Error) => error.message);

      expect(wrongPassword).toBe(unknownEmail);
    });
  });

  describe('refresh', () => {
    it('rotates the token: revokes the old row, links the replacement and issues a new pair', async () => {
      const existing = storedRefreshToken();
      refreshTokenDelegate.findUnique.mockResolvedValue(existing);
      refreshTokenDelegate.updateMany.mockResolvedValue({ count: 1 });
      const replacement = stubGeneratedRefreshToken('rotated');

      const result = await service.refresh(RAW_REFRESH_TOKEN);

      expect(refreshTokenDelegate.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: `sha256(${RAW_REFRESH_TOKEN})` },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true },
      });

      const [[revokeArgs]] = refreshTokenDelegate.updateMany.mock.calls as [
        [{ where: Record<string, unknown>; data: Record<string, unknown> }],
      ];
      expect(revokeArgs.where).toEqual({ id: existing.id, revokedAt: null });
      expect(revokeArgs.data.replacedByTokenHash).toBe(replacement.tokenHash);
      expect(revokeArgs.data.revokedAt).toBeInstanceOf(Date);

      expect(refreshTokenDelegate.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          tokenHash: replacement.tokenHash,
          expiresAt: replacement.expiresAt,
        },
      });
      expect(result.refreshToken).toBe(replacement.token);
      expect(result.accessToken).toBe(ACCESS_TOKEN);
    });

    it('rejects a token that is not in the database', async () => {
      refreshTokenDelegate.findUnique.mockResolvedValue(null);

      await expect(service.refresh('never-issued')).rejects.toThrow(InvalidRefreshTokenException);
      expect(refreshTokenDelegate.create).not.toHaveBeenCalled();
    });

    it('rejects an expired token without issuing a replacement', async () => {
      refreshTokenDelegate.findUnique.mockResolvedValue(
        storedRefreshToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh(RAW_REFRESH_TOKEN)).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(refreshTokenDelegate.updateMany).not.toHaveBeenCalled();
      expect(refreshTokenDelegate.create).not.toHaveBeenCalled();
    });

    it('treats a replayed (already revoked) token as theft: revokes every other live token for that user', async () => {
      refreshTokenDelegate.findUnique.mockResolvedValue(
        storedRefreshToken({ revokedAt: new Date(Date.now() - 60_000) }),
      );
      tokenService.revokeAllForUser.mockResolvedValue(3);

      await expect(service.refresh(RAW_REFRESH_TOKEN)).rejects.toThrow(
        InvalidRefreshTokenException,
      );

      // Delegated to TokenService, which owns the one revocation query the
      // users module reuses; the query itself is asserted in its own spec.
      expect(tokenService.revokeAllForUser).toHaveBeenCalledTimes(1);
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
      expect(refreshTokenDelegate.updateMany).not.toHaveBeenCalled();

      // No new session is handed out to whoever replayed the token.
      expect(refreshTokenDelegate.create).not.toHaveBeenCalled();
    });

    it('logs the reuse with the user id only, never the token', async () => {
      refreshTokenDelegate.findUnique.mockResolvedValue(
        storedRefreshToken({ revokedAt: new Date() }),
      );
      tokenService.revokeAllForUser.mockResolvedValue(2);

      await service.refresh(RAW_REFRESH_TOKEN).catch(() => undefined);

      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        { userId: USER_ID, revokedTokenCount: 2 },
        expect.stringContaining('replayed'),
      );
      const logged = JSON.stringify((Logger.prototype.warn as jest.Mock).mock.calls as unknown[][]);
      expect(logged).not.toContain(RAW_REFRESH_TOKEN);
    });

    it('rejects the loser when two refreshes race for the same token', async () => {
      refreshTokenDelegate.findUnique.mockResolvedValue(storedRefreshToken());
      // The competing request revoked the row between the read and the update.
      refreshTokenDelegate.updateMany.mockResolvedValue({ count: 0 });
      stubGeneratedRefreshToken();

      await expect(service.refresh(RAW_REFRESH_TOKEN)).rejects.toThrow(
        InvalidRefreshTokenException,
      );
      expect(refreshTokenDelegate.create).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the presented token by hash', async () => {
      refreshTokenDelegate.updateMany.mockResolvedValue({ count: 1 });

      await service.logout(RAW_REFRESH_TOKEN);

      const [[args]] = refreshTokenDelegate.updateMany.mock.calls as [
        [{ where: Record<string, unknown>; data: Record<string, unknown> }],
      ];
      expect(args.where).toEqual({
        tokenHash: `sha256(${RAW_REFRESH_TOKEN})`,
        revokedAt: null,
      });
      expect(args.data.revokedAt).toBeInstanceOf(Date);
    });

    it('succeeds silently for an unknown token so clients can retry safely', async () => {
      refreshTokenDelegate.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.logout('never-issued')).resolves.toBeUndefined();
    });
  });
});

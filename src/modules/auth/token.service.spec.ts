import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_CONFIG, MILLISECONDS_PER_DAY } from './auth.config';
import { RefreshTokenClient, TokenService } from './token.service';
import { JwtPayload } from './types/jwt-payload.interface';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('TokenService', () => {
  let jwtService: { signAsync: jest.Mock };
  let refreshTokenDelegate: { updateMany: jest.Mock };
  let service: TokenService;

  beforeEach(() => {
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt') };
    refreshTokenDelegate = { updateMany: jest.fn().mockResolvedValue({ count: 0 }) };
    service = new TokenService(
      jwtService as unknown as JwtService,
      {
        refreshToken: refreshTokenDelegate,
      } as unknown as PrismaService,
    );
  });

  describe('signAccessToken', () => {
    it('signs the user id into the sub claim and nothing else', async () => {
      await expect(service.signAccessToken(USER_ID)).resolves.toBe('signed.jwt');

      const [[payload]] = jwtService.signAsync.mock.calls as [[JwtPayload]];
      expect(payload).toEqual({ sub: USER_ID });
    });
  });

  describe('generateRefreshToken', () => {
    it('returns a high-entropy token with its hash and a 30-day expiry', () => {
      const now = new Date('2026-09-13T00:00:00.000Z');

      const generated = service.generateRefreshToken(now);

      // 32 random bytes, base64url-encoded and unpadded.
      expect(generated.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(generated.token, 'base64url')).toHaveLength(AUTH_CONFIG.refreshTokenBytes);
      expect(generated.expiresAt.getTime() - now.getTime()).toBe(
        AUTH_CONFIG.refreshTokenTtlDays * MILLISECONDS_PER_DAY,
      );
    });

    it('never returns a hash that reveals the token', () => {
      const generated = service.generateRefreshToken();

      expect(generated.tokenHash).not.toContain(generated.token);
      expect(generated.tokenHash).toBe(createHash('sha256').update(generated.token).digest('hex'));
    });

    it('generates a distinct token on every call', () => {
      const tokens = new Set(
        Array.from({ length: 25 }, () => service.generateRefreshToken().token),
      );

      expect(tokens.size).toBe(25);
    });
  });

  describe('hashRefreshToken', () => {
    it('is deterministic so a presented token can be looked up by hash', () => {
      expect(service.hashRefreshToken('a-token')).toBe(service.hashRefreshToken('a-token'));
    });

    it('produces a different digest for a different token', () => {
      expect(service.hashRefreshToken('token-a')).not.toBe(service.hashRefreshToken('token-b'));
    });

    it('returns a 64-character hex SHA-256 digest', () => {
      expect(service.hashRefreshToken('a-token')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('revokeAllForUser', () => {
    it("revokes only the user's own tokens, and only those still live", async () => {
      refreshTokenDelegate.updateMany.mockResolvedValue({ count: 3 });

      await expect(service.revokeAllForUser(USER_ID)).resolves.toBe(3);

      const [[args]] = refreshTokenDelegate.updateMany.mock.calls as [
        [{ where: Record<string, unknown>; data: Record<string, unknown> }],
      ];
      expect(args.where).toEqual({ userId: USER_ID, revokedAt: null });
      expect(args.data.revokedAt).toBeInstanceOf(Date);
    });

    it('reports zero when the user had no live sessions', async () => {
      refreshTokenDelegate.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeAllForUser(USER_ID)).resolves.toBe(0);
    });

    it("runs against a caller's transaction client when one is supplied", async () => {
      const transactionDelegate = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };

      await expect(
        service.revokeAllForUser(USER_ID, {
          refreshToken: transactionDelegate,
        } as unknown as RefreshTokenClient),
      ).resolves.toBe(1);

      expect(transactionDelegate.updateMany).toHaveBeenCalledTimes(1);
      // The revocation must not escape the caller's transaction.
      expect(refreshTokenDelegate.updateMany).not.toHaveBeenCalled();
    });
  });
});

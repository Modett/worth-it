import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_CONFIG } from './auth.config';
import { AuthTokensDto, TOKEN_TYPE } from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { SignupResponseDto } from './dto/signup-response.dto';
import {
  EmailAlreadyRegisteredException,
  InvalidCredentialsException,
  InvalidRefreshTokenException,
} from './exceptions/auth.exceptions';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async signup(dto: SignupDto): Promise<SignupResponseDto> {
    const email = normaliseEmail(dto.email);
    const passwordHash = await this.passwordService.hash(dto.password);

    try {
      // Onboarding fields (currency, monthlyBudget, defaultPauseHours) come
      // from their DB defaults; the users module collects the real values.
      const user = await this.prismaService.user.create({
        data: { email, passwordHash },
        select: { id: true, email: true, createdAt: true },
      });

      return { ...user, createdAt: user.createdAt.toISOString() };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new EmailAlreadyRegisteredException();
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthTokensDto> {
    const email = normaliseEmail(dto.email);
    const user = await this.prismaService.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      // Burn the same CPU a real verification would, so response time doesn't
      // disclose whether the address is registered.
      await this.passwordService.wasteComparison(dto.password);
      throw new InvalidCredentialsException();
    }

    const passwordMatches = await this.passwordService.verify(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    return this.issueTokens(user.id);
  }

  /**
   * Rotates the presented refresh token: the old one is revoked and linked to
   * its replacement, so a token can only ever be redeemed once.
   */
  async refresh(rawRefreshToken: string): Promise<AuthTokensDto> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);
    const existing = await this.prismaService.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });

    if (!existing) {
      throw new InvalidRefreshTokenException();
    }

    if (existing.revokedAt !== null) {
      await this.handleRefreshTokenReuse(existing.userId);
      throw new InvalidRefreshTokenException();
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new InvalidRefreshTokenException();
    }

    const now = new Date();
    const replacement = this.tokenService.generateRefreshToken(now);

    await this.prismaService.$transaction(async (tx) => {
      // Conditional on still being unrevoked: if two refreshes race, only one
      // updates a row, and the loser is rejected instead of minting a second
      // live token from the same parent.
      const revoked = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: now, replacedByTokenHash: replacement.tokenHash },
      });

      if (revoked.count === 0) {
        throw new InvalidRefreshTokenException();
      }

      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: replacement.tokenHash,
          expiresAt: replacement.expiresAt,
        },
      });
    });

    const accessToken = await this.tokenService.signAccessToken(existing.userId);
    return buildTokensResponse(accessToken, replacement.token);
  }

  /**
   * Idempotent by design: an unknown or already-revoked token still reports
   * success, so a client retrying logout over a flaky connection isn't told
   * anything about token validity.
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);

    await this.prismaService.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string): Promise<AuthTokensDto> {
    const accessToken = await this.tokenService.signAccessToken(userId);
    const refreshToken = this.tokenService.generateRefreshToken();

    await this.prismaService.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshToken.tokenHash,
        expiresAt: refreshToken.expiresAt,
      },
    });

    return buildTokensResponse(accessToken, refreshToken.token);
  }

  /**
   * A revoked token being presented again means either a client bug or a
   * stolen token that has since been rotated by the attacker or the victim.
   * Both are handled the same way: cut off every session for the user and
   * force a fresh login.
   */
  private async handleRefreshTokenReuse(userId: string): Promise<void> {
    const { count } = await this.prismaService.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // userId only — never the token or any other identifying material (§5).
    this.logger.warn(
      { userId, revokedTokenCount: count },
      'Revoked refresh token replayed; revoked all active refresh tokens for the user',
    );
  }
}

/** Emails are compared case-insensitively, so one canonical form is stored. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function buildTokensResponse(accessToken: string, refreshToken: string): AuthTokensDto {
  return {
    accessToken,
    refreshToken,
    tokenType: TOKEN_TYPE,
    expiresIn: AUTH_CONFIG.accessTokenTtlSeconds,
  };
}

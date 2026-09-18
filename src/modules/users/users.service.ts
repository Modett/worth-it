import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { IncorrectPasswordException, UserNotFoundException } from './exceptions/users.exceptions';

const RECORD_NOT_FOUND = 'P2025';

/**
 * The columns a profile response is built from. passwordHash is absent by
 * construction, so it never even leaves the database.
 */
const PROFILE_SELECT = {
  id: true,
  email: true,
  currency: true,
  monthlyBudget: true,
  defaultPauseHours: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });

    if (!user) {
      throw new UserNotFoundException();
    }

    return UserResponseDto.fromUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserResponseDto> {
    try {
      const user = await this.prismaService.user.update({
        where: { id: userId },
        // Prisma skips `undefined` fields, so an omitted preference keeps its
        // stored value instead of being overwritten with a default.
        data: {
          currency: dto.currency,
          monthlyBudget: dto.monthlyBudget,
          defaultPauseHours: dto.defaultPauseHours,
        },
        select: PROFILE_SELECT,
      });

      return UserResponseDto.fromUser(user);
    } catch (error) {
      if (isMissingRecordError(error)) {
        throw new UserNotFoundException();
      }
      throw error;
    }
  }

  /**
   * Changing a password ends every session: the point of the change is usually
   * that someone else may have the old one, so a live token elsewhere would
   * defeat it. The client re-authenticates afterwards, including on this device.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    await this.verifyPassword(userId, dto.currentPassword);
    const passwordHash = await this.passwordService.hash(dto.newPassword);

    const revokedTokenCount = await this.prismaService.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });

      // Same revocation path as refresh-token reuse detection (TokenService),
      // enlisted in this transaction so the new password and the dead sessions
      // commit together.
      return this.tokenService.revokeAllForUser(userId, tx);
    });

    // userId and counts only — never the password or a token (§5).
    this.logger.log(
      { userId, revokedTokenCount },
      'Password changed; revoked every refresh token for the user',
    );
  }

  /**
   * Deletes the User row and lets the schema's cascades take the dependent
   * items, scores, pauses, ratings, category stats and refresh tokens with it.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    await this.verifyPassword(userId, dto.currentPassword);

    try {
      await this.prismaService.user.delete({ where: { id: userId } });
    } catch (error) {
      if (isMissingRecordError(error)) {
        throw new UserNotFoundException();
      }
      throw error;
    }

    this.logger.log({ userId }, 'Account deleted at user request');
  }

  /** Shared confirmation step for the two destructive operations. */
  private async verifyPassword(userId: string, password: string): Promise<void> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new UserNotFoundException();
    }

    const matches = await this.passwordService.verify(password, user.passwordHash);
    if (!matches) {
      throw new IncorrectPasswordException();
    }
  }
}

/**
 * A write that finds no row means the access token outlived its user (deleted
 * account, or a concurrent delete), which is a domain condition rather than a
 * database failure to surface as a 500.
 */
function isMissingRecordError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === RECORD_NOT_FOUND;
}

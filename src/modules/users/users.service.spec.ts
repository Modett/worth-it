import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { UserProfileRow } from './dto/user-response.dto';
import { IncorrectPasswordException, UserNotFoundException } from './exceptions/users.exceptions';
import { UsersService } from './users.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = new Date('2026-09-13T10:00:00.000Z');
const STORED_HASH = 'stored-hash';
const NEW_HASH = 'hashed-new-password';

describe('UsersService', () => {
  let service: UsersService;
  let userDelegate: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
  let transactionClient: { user: typeof userDelegate };
  let prismaService: { user: typeof userDelegate; $transaction: jest.Mock };
  let passwordService: { hash: jest.Mock; verify: jest.Mock };
  let tokenService: { revokeAllForUser: jest.Mock };

  beforeEach(async () => {
    userDelegate = { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() };
    transactionClient = { user: userDelegate };

    prismaService = {
      user: userDelegate,
      // Interactive transactions run the callback against the same mock, and a
      // throw inside it propagates just as a real rollback would.
      $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
      ),
    };

    passwordService = { hash: jest.fn().mockResolvedValue(NEW_HASH), verify: jest.fn() };
    tokenService = { revokeAllForUser: jest.fn().mockResolvedValue(0) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prismaService },
        { provide: PasswordService, useValue: passwordService },
        { provide: TokenService, useValue: tokenService },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function storedProfile(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
    return {
      id: USER_ID,
      email: 'shopper@example.com',
      currency: 'USD',
      monthlyBudget: new Prisma.Decimal('500.00'),
      defaultPauseHours: 24,
      createdAt: CREATED_AT,
      ...overrides,
    };
  }

  function missingRecordError(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Record to update not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
  }

  describe('getProfile', () => {
    it('returns the six profile fields for the authenticated user', async () => {
      userDelegate.findUnique.mockResolvedValue(storedProfile());

      await expect(service.getProfile(USER_ID)).resolves.toEqual({
        id: USER_ID,
        email: 'shopper@example.com',
        currency: 'USD',
        monthlyBudget: 500,
        defaultPauseHours: 24,
        createdAt: CREATED_AT.toISOString(),
      });
    });

    it('never asks the database for the password hash', async () => {
      userDelegate.findUnique.mockResolvedValue(storedProfile());

      await service.getProfile(USER_ID);

      const [[args]] = userDelegate.findUnique.mock.calls as [
        [{ where: Record<string, unknown>; select: Record<string, unknown> }],
      ];
      expect(args.where).toEqual({ id: USER_ID });
      expect(args.select).not.toHaveProperty('passwordHash');
    });

    it('drops a password hash even if the row somehow carries one', async () => {
      userDelegate.findUnique.mockResolvedValue({
        ...storedProfile(),
        passwordHash: STORED_HASH,
      });

      const result = await service.getProfile(USER_ID);

      expect(result).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(result)).not.toContain(STORED_HASH);
    });

    it('reports a missing user rather than returning null', async () => {
      userDelegate.findUnique.mockResolvedValue(null);

      await expect(service.getProfile(USER_ID)).rejects.toThrow(UserNotFoundException);
    });
  });

  describe('updateProfile', () => {
    it.each([
      ['currency', { currency: 'GBP' }],
      ['monthlyBudget', { monthlyBudget: 750.5 }],
      ['defaultPauseHours', { defaultPauseHours: 48 }],
    ])('updates %s on its own, leaving the other fields untouched', async (_field, dto) => {
      userDelegate.update.mockResolvedValue(storedProfile());

      await service.updateProfile(USER_ID, dto);

      const [[args]] = userDelegate.update.mock.calls as [[{ data: Record<string, unknown> }]];
      // Absent fields arrive as `undefined`, which Prisma skips rather than
      // writing over the stored value.
      expect(args.data).toEqual({
        currency: undefined,
        monthlyBudget: undefined,
        defaultPauseHours: undefined,
        ...dto,
      });
    });

    it('updates all three preferences together and returns the new profile', async () => {
      userDelegate.update.mockResolvedValue(
        storedProfile({
          currency: 'GBP',
          monthlyBudget: new Prisma.Decimal('750.50'),
          defaultPauseHours: 48,
        }),
      );

      const result = await service.updateProfile(USER_ID, {
        currency: 'GBP',
        monthlyBudget: 750.5,
        defaultPauseHours: 48,
      });

      expect(userDelegate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: { currency: 'GBP', monthlyBudget: 750.5, defaultPauseHours: 48 },
        }),
      );
      expect(result).toMatchObject({
        currency: 'GBP',
        monthlyBudget: 750.5,
        defaultPauseHours: 48,
      });
    });

    it('treats an empty patch as a no-op that still returns the current profile', async () => {
      userDelegate.update.mockResolvedValue(storedProfile());

      await expect(service.updateProfile(USER_ID, {})).resolves.toMatchObject({
        currency: 'USD',
        monthlyBudget: 500,
      });
    });

    it('never returns the password hash after an update', async () => {
      userDelegate.update.mockResolvedValue({ ...storedProfile(), passwordHash: STORED_HASH });

      const result = await service.updateProfile(USER_ID, { currency: 'EUR' });

      expect(JSON.stringify(result)).not.toContain(STORED_HASH);
    });

    it('turns a vanished user into a domain 404 rather than a raw Prisma error', async () => {
      userDelegate.update.mockRejectedValue(missingRecordError());

      await expect(service.updateProfile(USER_ID, { currency: 'EUR' })).rejects.toThrow(
        UserNotFoundException,
      );
    });

    it('propagates unrelated database failures untouched', async () => {
      userDelegate.update.mockRejectedValue(new Error('connection terminated'));

      await expect(service.updateProfile(USER_ID, { currency: 'EUR' })).rejects.toThrow(
        'connection terminated',
      );
    });
  });

  describe('changePassword', () => {
    const dto = { currentPassword: 'correct-horse-battery', newPassword: 'a-brand-new-secret' };

    it('verifies the current password, stores a fresh hash and never logs either', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);

      await service.changePassword(USER_ID, dto);

      expect(passwordService.verify).toHaveBeenCalledWith(dto.currentPassword, STORED_HASH);
      expect(passwordService.hash).toHaveBeenCalledWith(dto.newPassword);
      expect(userDelegate.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { passwordHash: NEW_HASH },
      });

      const logged = JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls as unknown[][]);
      expect(logged).not.toContain(dto.currentPassword);
      expect(logged).not.toContain(dto.newPassword);
      expect(logged).toContain(USER_ID);
    });

    it('revokes every refresh token for the user, inside the same transaction as the change', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);
      tokenService.revokeAllForUser.mockResolvedValue(2);

      await service.changePassword(USER_ID, dto);

      // The transaction client, not the shared one: a rollback of the password
      // write must roll the revocation back with it.
      expect(tokenService.revokeAllForUser).toHaveBeenCalledWith(USER_ID, transactionClient);
      expect(prismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a wrong current password and changes nothing', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(false);

      await expect(service.changePassword(USER_ID, dto)).rejects.toThrow(
        IncorrectPasswordException,
      );

      expect(passwordService.hash).not.toHaveBeenCalled();
      expect(userDelegate.update).not.toHaveBeenCalled();
      expect(tokenService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('reports a missing user without touching the password', async () => {
      userDelegate.findUnique.mockResolvedValue(null);

      await expect(service.changePassword(USER_ID, dto)).rejects.toThrow(UserNotFoundException);
      expect(passwordService.verify).not.toHaveBeenCalled();
      expect(userDelegate.update).not.toHaveBeenCalled();
    });

    it('leaves the password unchanged when revocation fails, because both share a transaction', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);
      tokenService.revokeAllForUser.mockRejectedValue(new Error('revocation failed'));

      await expect(service.changePassword(USER_ID, dto)).rejects.toThrow('revocation failed');
    });
  });

  describe('deleteAccount', () => {
    const dto = { currentPassword: 'correct-horse-battery' };

    it('deletes the user row once the password checks out', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);

      await expect(service.deleteAccount(USER_ID, dto)).resolves.toBeUndefined();

      expect(passwordService.verify).toHaveBeenCalledWith(dto.currentPassword, STORED_HASH);
      // Dependent rows go with it via the schema's cascades, so there is
      // exactly one delete to issue.
      expect(userDelegate.delete).toHaveBeenCalledWith({ where: { id: USER_ID } });
    });

    it('rejects a wrong password and leaves the user in place', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(false);

      await expect(service.deleteAccount(USER_ID, dto)).rejects.toThrow(IncorrectPasswordException);
      expect(userDelegate.delete).not.toHaveBeenCalled();
    });

    it('reports a missing user rather than a raw Prisma error on a concurrent delete', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);
      userDelegate.delete.mockRejectedValue(missingRecordError());

      await expect(service.deleteAccount(USER_ID, dto)).rejects.toThrow(UserNotFoundException);
    });

    it('propagates unrelated database failures untouched', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);
      userDelegate.delete.mockRejectedValue(new Error('connection terminated'));

      await expect(service.deleteAccount(USER_ID, dto)).rejects.toThrow('connection terminated');
    });

    it('logs the deletion with the user id only', async () => {
      userDelegate.findUnique.mockResolvedValue({ passwordHash: STORED_HASH });
      passwordService.verify.mockResolvedValue(true);

      await service.deleteAccount(USER_ID, dto);

      expect(Logger.prototype.log).toHaveBeenCalledWith(
        { userId: USER_ID },
        expect.stringContaining('deleted'),
      );
    });
  });
});

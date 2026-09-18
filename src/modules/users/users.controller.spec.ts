import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { UserResponseDto } from './dto/user-response.dto';
import { USERS_CONFIG } from './users.config';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const profile: UserResponseDto = {
  id: USER_ID,
  email: 'shopper@example.com',
  currency: 'USD',
  monthlyBudget: 500,
  defaultPauseHours: 24,
  createdAt: '2026-09-13T10:00:00.000Z',
};

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    getProfile: jest.Mock;
    updateProfile: jest.Mock;
    changePassword: jest.Mock;
    deleteAccount: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      getProfile: jest.fn(),
      updateProfile: jest.fn(),
      changePassword: jest.fn(),
      deleteAccount: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = moduleRef.get(UsersController);
  });

  const reflector = new Reflector();

  it('reads the profile for the id from the access token, not from the request body', async () => {
    usersService.getProfile.mockResolvedValue(profile);

    await expect(controller.getProfile(USER_ID)).resolves.toBe(profile);
    expect(usersService.getProfile).toHaveBeenCalledWith(USER_ID);
  });

  it('delegates the profile update without adding logic', async () => {
    usersService.updateProfile.mockResolvedValue(profile);
    const dto = { currency: 'GBP' };

    await expect(controller.updateProfile(USER_ID, dto)).resolves.toBe(profile);
    expect(usersService.updateProfile).toHaveBeenCalledWith(USER_ID, dto);
  });

  it('delegates the password change', async () => {
    usersService.changePassword.mockResolvedValue(undefined);
    const dto = { currentPassword: 'old-password', newPassword: 'a-brand-new-secret' };

    await expect(controller.changePassword(USER_ID, dto)).resolves.toBeUndefined();
    expect(usersService.changePassword).toHaveBeenCalledWith(USER_ID, dto);
  });

  it('delegates the account deletion', async () => {
    usersService.deleteAccount.mockResolvedValue(undefined);
    const dto = { currentPassword: 'old-password' };

    await expect(controller.deleteAccount(USER_ID, dto)).resolves.toBeUndefined();
    expect(usersService.deleteAccount).toHaveBeenCalledWith(USER_ID, dto);
  });

  describe('route protection', () => {
    it.each(['getProfile', 'updateProfile', 'changePassword', 'deleteAccount'] as const)(
      '%s is not @Public(), so the global JWT guard protects it',
      (route) => {
        expect(
          reflector.get<boolean | undefined>(IS_PUBLIC_KEY, UsersController.prototype[route]),
        ).toBeUndefined();
      },
    );
  });

  describe('brute-force throttling', () => {
    // @Throttle() stores its numbers under metadata keys that @nestjs/throttler
    // does not export publicly, so asserting on them here would couple this
    // test to the library's internals. The limit is verified end to end in
    // test/users.e2e-spec.ts.
    it('keeps the password-confirmation limit tighter than the global default', () => {
      expect(USERS_CONFIG.passwordConfirmationThrottle.limit).toBeLessThan(100);
    });
  });
});

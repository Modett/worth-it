import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AUTH_CONFIG } from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokensDto } from './dto/auth-tokens.dto';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const tokens: AuthTokensDto = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  expiresIn: AUTH_CONFIG.accessTokenTtlSeconds,
};

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      signup: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = moduleRef.get(AuthController);
  });

  const reflector = new Reflector();

  it('delegates signup to the service without adding logic', async () => {
    const created = { id: USER_ID, email: 'shopper@example.com', createdAt: 'now' };
    authService.signup.mockResolvedValue(created);
    const dto = { email: 'shopper@example.com', password: 'correct-horse-battery' };

    await expect(controller.signup(dto)).resolves.toBe(created);
    expect(authService.signup).toHaveBeenCalledWith(dto);
  });

  it('delegates login to the service', async () => {
    authService.login.mockResolvedValue(tokens);
    const dto = { email: 'shopper@example.com', password: 'correct-horse-battery' };

    await expect(controller.login(dto)).resolves.toBe(tokens);
    expect(authService.login).toHaveBeenCalledWith(dto);
  });

  it('passes only the raw refresh token to the service on refresh', async () => {
    authService.refresh.mockResolvedValue(tokens);

    await expect(controller.refresh({ refreshToken: 'raw' })).resolves.toBe(tokens);
    expect(authService.refresh).toHaveBeenCalledWith('raw');
  });

  it('passes only the raw refresh token to the service on logout', async () => {
    authService.logout.mockResolvedValue(undefined);

    await expect(controller.logout({ refreshToken: 'raw' })).resolves.toBeUndefined();
    expect(authService.logout).toHaveBeenCalledWith('raw');
  });

  it('echoes the authenticated user id from @CurrentUser() on session', () => {
    expect(controller.session(USER_ID)).toEqual({ userId: USER_ID });
  });

  describe('route protection', () => {
    it.each(['signup', 'login', 'refresh', 'logout'] as const)(
      '%s is @Public() so unauthenticated clients can reach it',
      (route) => {
        expect(reflector.get<boolean>(IS_PUBLIC_KEY, AuthController.prototype[route])).toBe(true);
      },
    );

    it('session is not public, so the global JWT guard protects it', () => {
      expect(
        reflector.get<boolean | undefined>(IS_PUBLIC_KEY, AuthController.prototype.session),
      ).toBeUndefined();
    });
  });

  describe('brute-force throttling', () => {
    // @Throttle() stores its numbers under metadata keys that @nestjs/throttler
    // does not export publicly, so asserting on them here would couple this
    // test to the library's internals. The limit is verified end to end in
    // test/auth.e2e-spec.ts ("stops credential stuffing at the sixth login").
    it('keeps the credential limit tighter than the global default', () => {
      expect(AUTH_CONFIG.credentialThrottle.limit).toBeLessThan(100);
    });
  });
});

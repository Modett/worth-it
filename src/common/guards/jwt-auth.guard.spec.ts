import { Controller, ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Public } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('example')
class ExampleController {
  @Get('open')
  @Public()
  openRoute(): void {}

  @Get('closed')
  closedRoute(): void {}
}

@Public()
@Controller('open-example')
class PublicController {
  @Get('inherits')
  inheritsClassMetadata(): void {}
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let passportCanActivate: jest.SpyInstance;

  beforeEach(() => {
    guard = new JwtAuthGuard(new Reflector());
    // The passport half is exercised for real in the e2e suite; here we only
    // care whether the guard delegates to it or short-circuits.
    passportCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype as { canActivate: () => boolean }, 'canActivate')
      .mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function contextFor(handler: () => void, controllerClass: object): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => controllerClass,
    } as unknown as ExecutionContext;
  }

  it('requires a token by default, delegating to the passport strategy', () => {
    const result = guard.canActivate(
      contextFor(ExampleController.prototype.closedRoute, ExampleController),
    );

    expect(result).toBe(true);
    expect(passportCanActivate).toHaveBeenCalledTimes(1);
  });

  it('lets @Public() handlers through without touching the strategy', () => {
    const result = guard.canActivate(
      contextFor(ExampleController.prototype.openRoute, ExampleController),
    );

    expect(result).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });

  it('honours @Public() applied to the whole controller', () => {
    const result = guard.canActivate(
      contextFor(PublicController.prototype.inheritsClassMetadata, PublicController),
    );

    expect(result).toBe(true);
    expect(passportCanActivate).not.toHaveBeenCalled();
  });
});

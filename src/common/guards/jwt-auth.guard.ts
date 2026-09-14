import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export const JWT_STRATEGY_NAME = 'jwt';

/**
 * Registered as a global APP_GUARD, so every route requires a valid access
 * token unless it explicitly opts out with `@Public()` (.cursorrules §5).
 * Adding a new endpoint therefore cannot accidentally leave it unprotected.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard(JWT_STRATEGY_NAME) {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Handler metadata wins over controller metadata, so a @Public() class can
    // still have individual authenticated routes.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    return super.canActivate(context);
  }
}

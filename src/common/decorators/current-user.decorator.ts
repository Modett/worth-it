import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { RequestWithUser } from '../types/authenticated-user.interface';

/**
 * Injects the authenticated user's id into a controller handler.
 *
 * Only valid on routes covered by JwtAuthGuard (i.e. anything not marked
 * `@Public()`). On a public route there is no user, which is a programming
 * error rather than a client error — hence the 500 instead of a 401.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!request.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route without JwtAuthGuard — is it marked @Public()?',
      );
    }

    return request.user.userId;
  },
);

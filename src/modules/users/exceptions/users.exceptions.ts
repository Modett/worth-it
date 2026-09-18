import { ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Domain exceptions for the users module (.cursorrules §3). They extend Nest's
 * HttpExceptions so AllExceptionsFilter renders them in the standard error
 * shape, and no Prisma detail ever reaches the client.
 */

export class UserNotFoundException extends NotFoundException {
  constructor() {
    // Raised when a still-valid access token outlives its user row — the token
    // is genuine, so this is a 404 for the resource rather than a 401.
    super('User not found');
  }
}

export class IncorrectPasswordException extends ForbiddenException {
  constructor() {
    // 403 rather than 401: the request is authenticated, and a 401 would make
    // a mobile client treat this as an expired access token and try to refresh
    // instead of showing the user that they mistyped their password.
    super('The current password is incorrect');
  }
}

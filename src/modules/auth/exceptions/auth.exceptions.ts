import { ConflictException, UnauthorizedException } from '@nestjs/common';

/**
 * Domain exceptions for the auth module (.cursorrules §3). They extend Nest's
 * HttpExceptions so AllExceptionsFilter renders them in the standard error
 * shape, and they keep the HTTP status decision out of the service's callers.
 */

export class EmailAlreadyRegisteredException extends ConflictException {
  constructor() {
    // Deliberately does not echo the address back, and is only ever raised by
    // signup — enumeration risk is accepted here because a signup form has to
    // tell the user their email is taken.
    super('An account with this email already exists');
  }
}

export class InvalidCredentialsException extends UnauthorizedException {
  constructor() {
    // One message for "no such user" and "wrong password" so login cannot be
    // used to enumerate registered addresses.
    super('Invalid email or password');
  }
}

export class InvalidRefreshTokenException extends UnauthorizedException {
  constructor() {
    // Same message whether the token is unknown, expired, revoked or replayed:
    // the client's only correct response in every case is to log in again.
    super('Invalid or expired refresh token');
  }
}

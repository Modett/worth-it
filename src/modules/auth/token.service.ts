import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AUTH_CONFIG, MILLISECONDS_PER_DAY } from './auth.config';
import { JwtPayload } from './types/jwt-payload.interface';

export interface GeneratedRefreshToken {
  /** Returned to the client once; never persisted. */
  token: string;
  /** What goes in RefreshToken.tokenHash. */
  tokenHash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwtService: JwtService) {}

  signAccessToken(userId: string): Promise<string> {
    const payload: JwtPayload = { sub: userId };
    return this.jwtService.signAsync(payload);
  }

  generateRefreshToken(now: Date = new Date()): GeneratedRefreshToken {
    // base64url keeps the token safe to put in a JSON body or header without
    // escaping, and 32 random bytes give 256 bits of entropy.
    const token = randomBytes(AUTH_CONFIG.refreshTokenBytes).toString('base64url');

    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(now.getTime() + AUTH_CONFIG.refreshTokenTtlDays * MILLISECONDS_PER_DAY),
    };
  }

  /**
   * SHA-256 rather than bcrypt: the input is 256 bits of uniform randomness,
   * so there is no dictionary to defend against and a fast digest keeps the
   * refresh path cheap. Passwords are a different story — see PasswordService.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithoutRequest } from 'passport-jwt';
import { AuthenticatedUser } from '../../../common/types/authenticated-user.interface';
import { JWT_STRATEGY_NAME } from '../../../common/guards/jwt-auth.guard';
import { EnvironmentVariables } from '../../../config/env.validation';
import { JwtPayload } from '../types/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY_NAME) {
  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    const options: StrategyOptionsWithoutRequest = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.get('JWT_SECRET', { infer: true }),
      // Expiry is enforced by passport-jwt rather than trusted from the client.
      ignoreExpiration: false,
    };

    super(options);
  }

  /**
   * Passport has already verified the signature and expiry, so this only maps
   * claims onto the request.
   *
   * Deliberately does not load the user from the database: access tokens live
   * for 15 minutes, and a per-request lookup would put a query on every
   * authenticated endpoint for a 15-minute-at-most staleness window. Anything
   * needing revocation faster than that (e.g. a ban) should invalidate the
   * user's refresh tokens and shorten the access token TTL.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub };
  }
}

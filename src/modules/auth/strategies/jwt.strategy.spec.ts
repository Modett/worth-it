import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../../config/env.validation';
import { JwtStrategy } from './jwt.strategy';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('JwtStrategy', () => {
  function createStrategy(): JwtStrategy {
    const configService = {
      get: jest.fn(() => 'a'.repeat(32)),
    } as unknown as ConfigService<EnvironmentVariables, true>;

    return new JwtStrategy(configService);
  }

  it('reads the signing secret from validated config, not process.env', () => {
    const get = jest.fn(() => 'a'.repeat(32));
    const configService = { get } as unknown as ConfigService<EnvironmentVariables, true>;

    new JwtStrategy(configService);

    expect(get).toHaveBeenCalledWith('JWT_SECRET', { infer: true });
  });

  it('maps the sub claim onto the request user', () => {
    expect(createStrategy().validate({ sub: USER_ID })).toEqual({ userId: USER_ID });
  });
});

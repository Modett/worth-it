import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  EnvironmentValidationError,
  EnvironmentVariables,
  validateEnvironment,
} from './env.validation';

const validEnvironment: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  AI_EXTRACTION_API_KEY: 'extraction-key',
  AI_COPY_API_KEY: 'copy-key',
  R2_ACCESS_KEY: 'r2-access',
  R2_SECRET_KEY: 'r2-secret',
  R2_BUCKET: 'bucket',
};

const REQUIRED_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'AI_EXTRACTION_API_KEY',
  'AI_COPY_API_KEY',
  'R2_ACCESS_KEY',
  'R2_SECRET_KEY',
  'R2_BUCKET',
  'PORT',
] as const;

function withoutKey(env: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _removed, ...rest } = env;
  return rest;
}

describe('validateEnvironment', () => {
  it('accepts a complete environment and applies defaults', () => {
    const result = validateEnvironment(validEnvironment);

    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_POOL_MAX).toBe(10);
    expect(result.THROTTLE_TTL_SECONDS).toBe(60);
    expect(result.THROTTLE_LIMIT).toBe(100);
  });

  it.each(REQUIRED_KEYS)('fails when required variable %s is missing', (key) => {
    expect(() => validateEnvironment(withoutKey(validEnvironment, key))).toThrow(
      EnvironmentValidationError,
    );
    expect(() => validateEnvironment(withoutKey(validEnvironment, key))).toThrow(
      new RegExp(`"${key}" is required`),
    );
  });

  it('reports every missing variable at once rather than stopping at the first', () => {
    let caught: unknown;
    try {
      validateEnvironment({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvironmentValidationError);
    const { details } = caught as EnvironmentValidationError;
    for (const key of REQUIRED_KEYS) {
      expect(details).toEqual(expect.arrayContaining([expect.stringContaining(`"${key}"`)]));
    }
  });

  it('rejects malformed values', () => {
    expect(() => validateEnvironment({ ...validEnvironment, PORT: 'not-a-port' })).toThrow(
      /"PORT" must be a number/,
    );
    expect(() =>
      validateEnvironment({ ...validEnvironment, DATABASE_URL: 'mysql://localhost/db' }),
    ).toThrow(/"DATABASE_URL"/);
    expect(() => validateEnvironment({ ...validEnvironment, NODE_ENV: 'staging' })).toThrow(
      /"NODE_ENV" must be one of/,
    );
  });

  it('rejects weak or reused secrets', () => {
    expect(() => validateEnvironment({ ...validEnvironment, JWT_SECRET: 'short' })).toThrow(
      /"JWT_SECRET" length must be at least 32/,
    );
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        JWT_REFRESH_SECRET: validEnvironment.JWT_SECRET,
      }),
    ).toThrow(/"JWT_REFRESH_SECRET" must differ from JWT_SECRET/);
  });
});

describe('ConfigModule bootstrap with validateEnvironment', () => {
  // ConfigModule validates `process.env` itself, so each test gets a
  // controlled copy and the real environment is restored afterwards.
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { PATH: originalEnv.PATH };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function bootstrapWithEnvironment(
    env: Record<string, string>,
  ): Promise<ConfigService<EnvironmentVariables, true>> {
    Object.assign(process.env, env);
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, validate: validateEnvironment })],
    }).compile();
    return moduleRef.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  }

  it('refuses to compile the Nest module when required variables are missing', async () => {
    await expect(
      bootstrapWithEnvironment(withoutKey(validEnvironment, 'DATABASE_URL')),
    ).rejects.toThrow(/"DATABASE_URL" is required/);
  });

  it('exposes typed, coerced values when the environment is valid', async () => {
    const config = await bootstrapWithEnvironment(validEnvironment);

    expect(config.get('PORT', { infer: true })).toBe(3000);
    expect(config.get('NODE_ENV', { infer: true })).toBe('test');
    expect(config.get('DATABASE_POOL_MAX', { infer: true })).toBe(10);
  });
});

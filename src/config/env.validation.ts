import * as Joi from 'joi';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const AI_EXTRACTION_PROVIDERS = ['openai'] as const;
export type AiExtractionProviderName = (typeof AI_EXTRACTION_PROVIDERS)[number];

/**
 * Fully validated, typed view of the process environment. Business code
 * reads these through `ConfigService<EnvironmentVariables, true>` — never
 * through `process.env` directly (.cursorrules §1, §5).
 */
export interface EnvironmentVariables {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  LOG_LEVEL: LogLevel;

  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  REDIS_URL: string;

  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;

  AI_EXTRACTION_API_KEY: string;
  AI_COPY_API_KEY: string;
  /**
   * Which extraction implementation `AI_EXTRACTION_SERVICE` resolves to. A new
   * provider is a new allowed value here plus a branch in AiModule — callers
   * keep injecting the token.
   */
  AI_EXTRACTION_PROVIDER: AiExtractionProviderName;

  R2_ACCESS_KEY: string;
  R2_SECRET_KEY: string;
  R2_BUCKET: string;
  /** S3 API endpoint, e.g. `https://<accountid>.r2.cloudflarestorage.com`. */
  R2_ENDPOINT: string;
  /** Public base URL used to store `Item.imageUrl` after an upload. */
  R2_PUBLIC_BASE_URL: string;

  THROTTLE_TTL_SECONDS: number;
  THROTTLE_LIMIT: number;
}

const DEFAULTS = {
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  DATABASE_POOL_MAX: 10,
  THROTTLE_TTL_SECONDS: 60,
  THROTTLE_LIMIT: 100,
  AI_EXTRACTION_PROVIDER: 'openai',
} as const;

// Secrets shorter than this are trivially brute-forceable; refuse them at boot
// rather than discovering the problem in production.
const MIN_SECRET_LENGTH = 32;

export const envValidationSchema = Joi.object<EnvironmentVariables, true>({
  NODE_ENV: Joi.string()
    .valid(...NODE_ENVIRONMENTS)
    .default(DEFAULTS.NODE_ENV),
  PORT: Joi.number().port().required(),
  LOG_LEVEL: Joi.string()
    .valid(...LOG_LEVELS)
    .default(DEFAULTS.LOG_LEVEL),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).default(DEFAULTS.DATABASE_POOL_MAX),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),

  JWT_SECRET: Joi.string().min(MIN_SECRET_LENGTH).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(MIN_SECRET_LENGTH)
    .invalid(Joi.ref('JWT_SECRET'))
    .required()
    .messages({
      'any.invalid': '"JWT_REFRESH_SECRET" must differ from JWT_SECRET',
    }),

  AI_EXTRACTION_API_KEY: Joi.string().required(),
  AI_COPY_API_KEY: Joi.string().required(),
  AI_EXTRACTION_PROVIDER: Joi.string()
    .valid(...AI_EXTRACTION_PROVIDERS)
    .default(DEFAULTS.AI_EXTRACTION_PROVIDER),

  R2_ACCESS_KEY: Joi.string().required(),
  R2_SECRET_KEY: Joi.string().required(),
  R2_BUCKET: Joi.string().required(),
  R2_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  R2_PUBLIC_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),

  THROTTLE_TTL_SECONDS: Joi.number().integer().min(1).default(DEFAULTS.THROTTLE_TTL_SECONDS),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(DEFAULTS.THROTTLE_LIMIT),
});

export class EnvironmentValidationError extends Error {
  constructor(public readonly details: readonly string[]) {
    super(
      [
        'Invalid environment configuration — refusing to start:',
        ...details.map((detail) => `  - ${detail}`),
      ].join('\n'),
    );
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * Validates the raw environment and returns the typed, defaulted result.
 * Throws {@link EnvironmentValidationError} listing *every* problem at once
 * so a misconfigured deploy can be fixed in a single pass.
 */
export function validateEnvironment(raw: Record<string, unknown>): EnvironmentVariables {
  const result: Joi.ValidationResult<EnvironmentVariables> = envValidationSchema.validate(raw, {
    abortEarly: false,
    allowUnknown: true,
    convert: true,
  });

  if (result.error) {
    throw new EnvironmentValidationError(result.error.details.map((detail) => detail.message));
  }

  return result.value;
}

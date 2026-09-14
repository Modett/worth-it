/** Injection token for the shared ioredis client. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Upper bound for a health-check PING before Redis is reported unhealthy. */
export const REDIS_HEALTH_TIMEOUT_MS = 2_000;

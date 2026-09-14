import type { ConnectionOptions as TlsConnectionOptions } from 'node:tls';

const DEFAULT_REDIS_PORT = 6379;
const TLS_SCHEME = 'rediss:';

/**
 * The subset of connection options shared by ioredis and BullMQ. Kept
 * deliberately narrow so one parsed REDIS_URL can be spread into either
 * library's option type without casting.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: TlsConnectionOptions;
}

/**
 * Converts a `redis://` / `rediss://` URL into explicit connection options so
 * the single source of truth (REDIS_URL) can feed both the shared client and
 * BullMQ, which builds its own blocking connections from options.
 */
export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const url = new URL(redisUrl);

  const databaseSegment = url.pathname.replace(/^\//, '');
  const database = databaseSegment.length > 0 ? Number(databaseSegment) : undefined;

  if (database !== undefined && !Number.isInteger(database)) {
    throw new Error(`REDIS_URL has a non-integer database index: "${databaseSegment}"`);
  }

  const options: RedisConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : DEFAULT_REDIS_PORT,
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (database !== undefined) {
    options.db = database;
  }
  if (url.protocol === TLS_SCHEME) {
    options.tls = {};
  }

  return options;
}

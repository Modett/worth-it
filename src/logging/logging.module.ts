import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { EnvironmentVariables } from '../config/env.validation';

const REQUEST_ID_HEADER = 'x-request-id';

/** Paths whose request logs are pure noise (polled by load balancers). */
const UNLOGGED_PATH_PREFIXES = ['/api/v1/health'];

/** Header values that must never reach the log stream (.cursorrules §5). */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
];

/**
 * Structured JSON logging via nestjs-pino. Every request gets a request id
 * (propagated from the client's X-Request-Id when present) so log lines from
 * one call can be correlated across replicas.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables, true>) => {
        const isDevelopment = configService.get('NODE_ENV', { infer: true }) === 'development';

        return {
          pinoHttp: {
            level: configService.get('LOG_LEVEL', { infer: true }),
            genReqId: (request: IncomingMessage) => {
              const incoming = request.headers[REQUEST_ID_HEADER];
              return typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
            },
            redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
            autoLogging: {
              ignore: (request: IncomingMessage) =>
                UNLOGGED_PATH_PREFIXES.some((prefix) => request.url?.startsWith(prefix) ?? false),
            },
            // Human-readable output is only for local terminals; production
            // ships raw JSON so Railway's log tooling can index it.
            transport: isDevelopment
              ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}

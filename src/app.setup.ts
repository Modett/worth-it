import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

export const API_GLOBAL_PREFIX = 'api';
export const API_DEFAULT_VERSION = '1';
export const SWAGGER_PATH = 'api/docs';

/**
 * Railway terminates TLS at its edge proxy and forwards to the app, so exactly
 * one hop is trusted: `req.ip` (used for rate-limit keys) becomes the real
 * client address while client-supplied X-Forwarded-For values are ignored.
 */
const TRUSTED_PROXY_HOPS = 1;

/**
 * Applies the HTTP-layer configuration shared by `main.ts` and the e2e test
 * harness, so tests exercise exactly the routing and middleware production
 * uses. DI-registered globals (pipe, filter, guard) live in AppModule.
 */
export function configureApp(app: NestExpressApplication): INestApplication {
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.set('trust proxy', TRUSTED_PROXY_HOPS);

  // Routes resolve to /api/v1/...; a future breaking change ships as v2
  // alongside v1 rather than mutating it (.cursorrules §6).
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Worth it? API')
      .setDescription('Regret Risk scoring, purchase pauses and post-purchase tracking')
      .setVersion(`v${API_DEFAULT_VERSION}`)
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, swaggerDocument);

  return app;
}

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, SWAGGER_PATH } from './app.setup';
import { EnvironmentVariables } from './config/env.validation';

async function bootstrap(): Promise<void> {
  // Buffer until the pino logger is attached so even boot logs are JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);

  const configService = app.get(ConfigService<EnvironmentVariables, true>);
  const port = configService.get('PORT', { infer: true });

  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`API listening on port ${port}; Swagger UI at /${SWAGGER_PATH}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // The logger may not exist yet if config validation failed, so this is the
  // one place a raw console write is acceptable.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

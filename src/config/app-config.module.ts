import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './env.validation';

const ENV_FILE_BY_NODE_ENV: Record<string, string> = {
  test: '.env.test',
};

/**
 * Global, validated configuration. Importing this module anywhere in the
 * dependency graph makes `ConfigService<EnvironmentVariables, true>`
 * injectable everywhere; boot fails fast if the environment is invalid.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: false,
      envFilePath: ENV_FILE_BY_NODE_ENV[process.env.NODE_ENV ?? ''] ?? '.env',
      validate: validateEnvironment,
    }),
  ],
})
export class AppConfigModule {}

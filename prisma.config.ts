import { config as loadDotenv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI runs outside Nest's ConfigModule, so it loads its own env.
// Existing process variables always win (CI injects DATABASE_URL directly).
loadDotenv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

// `prisma generate` (run on every `npm install`) needs no database, so the
// datasource is only declared when a URL is present; migrate/studio commands
// still fail loudly without one.
const datasource = process.env.DATABASE_URL ? { url: env('DATABASE_URL') } : undefined;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(datasource ? { datasource } : {}),
});

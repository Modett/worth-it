import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// Runs before each e2e test file. `.env.test` supplies local defaults; any
// variable already in the environment (e.g. CI service container URLs) wins.
process.env.NODE_ENV = 'test';
loadDotenv({ path: resolve(__dirname, '..', '.env.test'), override: false, quiet: true });

# Worth it? — API

Backend for the "Worth it?" mobile app: Regret Risk scoring, purchase
cooling-off pauses and post-purchase regret tracking. Engineering rules live
in [`.cursorrules`](./.cursorrules); the product spec belongs in
`docs/product-spec.md`.

## Stack

NestJS 11 (TypeScript, strict) · Prisma 7 + PostgreSQL · Redis (ioredis) +
BullMQ · nestjs-pino · Joi-validated `@nestjs/config` · Swagger · Jest +
Supertest. Deployed to Railway.

## Getting started

Requirements: Node 20.19+, Docker (for local Postgres and Redis).

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # fill in real secrets
docker compose up -d        # Postgres (worthit + worthit_test DBs) and Redis
npm run prisma:migrate:dev  # apply migrations to the dev database
npm run start:dev
```

- API base path: `http://localhost:3000/api/v1`
- Health check: `GET /api/v1/health` → `{ status, db, redis, timestamp }`
- Swagger UI: `http://localhost:3000/api/docs`

The app refuses to boot if any required environment variable is missing or
malformed, and prints every problem at once.

## Authentication

Every endpoint requires a valid access token unless it is marked `@Public()`.
Send it as `Authorization: Bearer <accessToken>`, and read the current user in
a controller with `@CurrentUser() userId: string`.

| Endpoint                    | Purpose                                            |
| --------------------------- | -------------------------------------------------- |
| `POST /api/v1/auth/signup`  | Create an account from email + password            |
| `POST /api/v1/auth/login`   | Exchange credentials for an access + refresh token |
| `POST /api/v1/auth/refresh` | Rotate the refresh token for a new pair            |
| `POST /api/v1/auth/logout`  | Revoke a refresh token                             |
| `GET /api/v1/auth/session`  | Check whether an access token is still valid       |

Access tokens are JWTs valid for 15 minutes. Refresh tokens are opaque random
strings valid for 30 days, stored only as a SHA-256 hash and rotated on every
use; presenting an already-used refresh token is treated as theft and revokes
every active session for that user. Signup and login are limited to 5 requests
per minute per IP. Tunables live in `src/modules/auth/auth.config.ts`.

## Items from a screenshot

`POST /api/v1/items/from-screenshot` accepts a JPEG, PNG or WebP upload (max
8MB), stores the original in Cloudflare R2, and runs the extraction provider
bound to `AI_EXTRACTION_SERVICE` (GPT-5 Mini today). High-confidence results
create the item; low-confidence results return a pre-filled draft for
`POST /api/v1/items` with `source: SCREENSHOT`. The route is limited to 5
requests per minute per IP.

Tunables live in `src/modules/ai/ai.config.ts` and `ITEMS_CONFIG.screenshot`.

## Testing

```bash
npm run test        # unit tests (no DB / Redis needed)
npm run test:e2e    # applies migrations to worthit_test, then runs e2e suite
npm run lint
```

E2E tests read `.env.test`; variables already set in the environment take
precedence, which is how CI points the suite at its service containers.

## Project layout

```
src/
  main.ts, app.module.ts, app.setup.ts   bootstrap + shared HTTP configuration
  config/         validated env schema and global ConfigModule
  prisma/         PrismaService (pooled pg adapter)
  redis/          shared ioredis client, BullMQ root connection
  logging/        nestjs-pino structured logging
  common/         decorators, filters, guards, interceptors, pipes
  modules/        one feature module per domain concept
  generated/      Prisma client output (gitignored, regenerated on install)
prisma/           schema.prisma and migrations
test/             e2e suites (*.e2e-spec.ts)
```

## Conventions

Conventional Commits; one module per branch/PR; a pre-commit hook runs
lint-staged and the unit suite. CI (`.github/workflows/ci.yml`) runs lint,
format check, build, unit tests and e2e tests against Postgres + Redis
service containers on every push.

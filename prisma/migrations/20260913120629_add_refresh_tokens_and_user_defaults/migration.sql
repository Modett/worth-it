-- Signup (auth module) creates a User from email + password alone, so the
-- onboarding fields need DB-level defaults. `currency` and `defaultPauseHours`
-- already had them from the initial migration; `monthlyBudget` was nullable
-- and now carries a default instead, so the users module can overwrite it.

-- Backfill before tightening the constraint: existing rows (if any) adopt the
-- same default rather than failing the migration.
UPDATE "users" SET "monthlyBudget" = 500.00 WHERE "monthlyBudget" IS NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "monthlyBudget" SET NOT NULL,
ALTER COLUMN "monthlyBudget" SET DEFAULT 500.00;

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedByTokenHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

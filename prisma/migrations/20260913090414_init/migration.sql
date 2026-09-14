-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('SCREENSHOT', 'LINK', 'MANUAL');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('WISHLIST', 'PAUSED', 'PURCHASED', 'SKIPPED', 'RETURNED');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('GO_FOR_IT', 'THINK_ABOUT_IT', 'PAUSE', 'LIKELY_REGRET', 'YOU_DECIDE');

-- CreateEnum
CREATE TYPE "CheckinResult" AS ENUM ('YES', 'NOT_SURE', 'NO');

-- CreateEnum
CREATE TYPE "PurchaseRatingValue" AS ENUM ('LOVE', 'HAPPY', 'NEUTRAL', 'REGRET', 'WISH_HADNT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "monthlyBudget" DECIMAL(12,2),
    "defaultPauseHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" "ItemSource" NOT NULL,
    "imageUrl" TEXT,
    "productName" TEXT NOT NULL,
    "brand" TEXT,
    "category" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "detectedSaleLanguage" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ItemStatus" NOT NULL DEFAULT 'WISHLIST',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regret_scores" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "factorBreakdown" JSONB NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regret_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pauses" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "pauseHours" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "checkinResult" "CheckinResult",

    CONSTRAINT "pauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_ratings" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "ratedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" "PurchaseRatingValue" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "purchase_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_regret_stats" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "regretRate" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_regret_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "items_userId_status_idx" ON "items"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "regret_scores_itemId_key" ON "regret_scores"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "pauses_itemId_key" ON "pauses"("itemId");

-- CreateIndex
CREATE INDEX "pauses_endsAt_idx" ON "pauses"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_ratings_itemId_key" ON "purchase_ratings"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "category_regret_stats_userId_category_key" ON "category_regret_stats"("userId", "category");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regret_scores" ADD CONSTRAINT "regret_scores_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pauses" ADD CONSTRAINT "pauses_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_ratings" ADD CONSTRAINT "purchase_ratings_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_regret_stats" ADD CONSTRAINT "category_regret_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

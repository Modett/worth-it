-- AlterTable
ALTER TABLE "items" ADD COLUMN     "sourceUrl" TEXT;

-- CreateIndex
CREATE INDEX "items_userId_discoveredAt_idx" ON "items"("userId", "discoveredAt");

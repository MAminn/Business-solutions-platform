-- CreateEnum
CREATE TYPE "BreakdownDimension" AS ENUM ('PUBLISHER_PLATFORM', 'PLATFORM_POSITION', 'IMPRESSION_DEVICE', 'GENDER', 'AGE', 'COUNTRY', 'REGION');

-- CreateTable
CREATE TABLE "InsightsBreakdownDaily" (
    "id" TEXT NOT NULL,
    "entityType" "InsightEntity" NOT NULL,
    "entityId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dimension" "BreakdownDimension" NOT NULL,
    "value" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "conversionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsightsBreakdownDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InsightsBreakdownDaily_entityType_entityId_dimension_date_idx" ON "InsightsBreakdownDaily"("entityType", "entityId", "dimension", "date");

-- CreateIndex
CREATE INDEX "InsightsBreakdownDaily_dimension_date_idx" ON "InsightsBreakdownDaily"("dimension", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InsightsBreakdownDaily_entityType_entityId_date_dimension_v_key" ON "InsightsBreakdownDaily"("entityType", "entityId", "date", "dimension", "value");

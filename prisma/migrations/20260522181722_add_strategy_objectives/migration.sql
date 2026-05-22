-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignObjectiveType" AS ENUM ('SALES', 'LEADS', 'TRAFFIC', 'ENGAGEMENT', 'AWARENESS', 'APP_PROMOTION', 'OTHER');

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT,
    "status" "StrategyStatus" NOT NULL DEFAULT 'ACTIVE',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "monthlyBudget" DECIMAL(12,2),
    "revenueGoal" DECIMAL(12,2),
    "conversionGoal" INTEGER,
    "minCpa" DECIMAL(10,2),
    "maxCpa" DECIMAL(10,2),
    "minRoas" DECIMAL(6,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyObjective" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "type" "CampaignObjectiveType" NOT NULL,
    "allocatedBudget" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyObjective_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Strategy_clientId_status_idx" ON "Strategy"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyObjective_strategyId_type_key" ON "StrategyObjective"("strategyId", "type");

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyObjective" ADD CONSTRAINT "StrategyObjective_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

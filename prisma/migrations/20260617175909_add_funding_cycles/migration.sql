-- CreateTable
CREATE TABLE "FundingCycle" (
    "id" TEXT NOT NULL,
    "adAccountConnectionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundAlertSent" (
    "id" TEXT NOT NULL,
    "fundingCycleId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundAlertSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingCycle_adAccountConnectionId_startedAt_idx" ON "FundingCycle"("adAccountConnectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FundAlertSent_fundingCycleId_threshold_key" ON "FundAlertSent"("fundingCycleId", "threshold");

-- AddForeignKey
ALTER TABLE "FundingCycle" ADD CONSTRAINT "FundingCycle_adAccountConnectionId_fkey" FOREIGN KEY ("adAccountConnectionId") REFERENCES "AdAccountConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundAlertSent" ADD CONSTRAINT "FundAlertSent_fundingCycleId_fkey" FOREIGN KEY ("fundingCycleId") REFERENCES "FundingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

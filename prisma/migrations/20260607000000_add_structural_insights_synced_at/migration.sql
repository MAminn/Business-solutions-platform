-- AlterTable
ALTER TABLE "AdAccountConnection" ADD COLUMN "structuralSyncedAt" TIMESTAMP(3);
ALTER TABLE "AdAccountConnection" ADD COLUMN "insightsBackfilledAt" TIMESTAMP(3);

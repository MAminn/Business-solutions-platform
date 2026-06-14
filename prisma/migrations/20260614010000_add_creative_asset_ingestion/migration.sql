-- CreateEnum
CREATE TYPE "CreativeAssetKind" AS ENUM ('IMAGE', 'VIDEO', 'POSTER');

-- CreateEnum
CREATE TYPE "CreativeAssetStatus" AS ENUM ('PENDING', 'RESOLVING', 'FETCHING', 'READY', 'FAILED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "IngestionJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "CreativeAsset" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "kind" "CreativeAssetKind" NOT NULL,
    "status" "CreativeAssetStatus" NOT NULL DEFAULT 'PENDING',
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "cdnUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "mimeType" TEXT,
    "contentHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "storedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "creativeId" TEXT NOT NULL,
    "kind" "CreativeAssetKind" NOT NULL,
    "status" "IngestionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreativeAsset_status_idx" ON "CreativeAsset"("status");

-- CreateIndex
CREATE INDEX "CreativeAsset_contentHash_idx" ON "CreativeAsset"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeAsset_creativeId_kind_key" ON "CreativeAsset"("creativeId", "kind");

-- CreateIndex
CREATE INDEX "IngestionJob_status_idx" ON "IngestionJob"("status");

-- AddForeignKey
ALTER TABLE "CreativeAsset" ADD CONSTRAINT "CreativeAsset_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "Creative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

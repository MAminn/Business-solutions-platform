-- AlterTable
ALTER TABLE "AdAccountConnection" ADD COLUMN     "tiktokAppProfileId" TEXT;

-- CreateTable
CREATE TABLE "TikTokAppProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "appSecretEnc" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT 'v1.3',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TikTokAppProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingTikTokOAuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tiktokAppProfileId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "advertisers" JSONB NOT NULL,
    "scopes" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingTikTokOAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TikTokAppProfile_organizationId_idx" ON "TikTokAppProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "TikTokAppProfile_organizationId_appId_key" ON "TikTokAppProfile"("organizationId", "appId");

-- CreateIndex
CREATE INDEX "PendingTikTokOAuthSession_expiresAt_idx" ON "PendingTikTokOAuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AdAccountConnection_tiktokAppProfileId_idx" ON "AdAccountConnection"("tiktokAppProfileId");

-- AddForeignKey
ALTER TABLE "TikTokAppProfile" ADD CONSTRAINT "TikTokAppProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccountConnection" ADD CONSTRAINT "AdAccountConnection_tiktokAppProfileId_fkey" FOREIGN KEY ("tiktokAppProfileId") REFERENCES "TikTokAppProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

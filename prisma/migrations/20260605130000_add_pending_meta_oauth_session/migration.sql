-- CreateTable
CREATE TABLE "PendingMetaOAuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "metaAppProfileId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "accounts" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMetaOAuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingMetaOAuthSession_expiresAt_idx" ON "PendingMetaOAuthSession"("expiresAt");

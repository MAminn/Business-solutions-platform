-- CreateTable
CREATE TABLE "MetaAppProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "appSecretEnc" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL DEFAULT 'v23.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaAppProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaAppProfile_organizationId_idx" ON "MetaAppProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaAppProfile_organizationId_appId_key" ON "MetaAppProfile"("organizationId", "appId");

-- AlterTable
ALTER TABLE "AdAccountConnection" ADD COLUMN "metaAppProfileId" TEXT;

-- CreateIndex
CREATE INDEX "AdAccountConnection_metaAppProfileId_idx" ON "AdAccountConnection"("metaAppProfileId");

-- AddForeignKey
ALTER TABLE "MetaAppProfile" ADD CONSTRAINT "MetaAppProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccountConnection" ADD CONSTRAINT "AdAccountConnection_metaAppProfileId_fkey" FOREIGN KEY ("metaAppProfileId") REFERENCES "MetaAppProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

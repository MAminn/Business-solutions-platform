-- CreateEnum
CREATE TYPE "BillingCycleStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BillingPaymentMethod" AS ENUM ('BANK_TRANSFER', 'INSTAPAY', 'CASH', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingEmailKind" AS ENUM ('PAYMENT_RECEIPT', 'SECOND_INSTALLMENT_REMINDER_CLIENT', 'SECOND_INSTALLMENT_REMINDER_INTERNAL');

-- CreateEnum
CREATE TYPE "BillingEmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "billingContactEmail" TEXT,
ADD COLUMN     "billingContactName" TEXT,
ADD COLUMN     "billingCycleStartDate" DATE,
ADD COLUMN     "billingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceFeeAmount" DECIMAL(12,2),
ADD COLUMN     "serviceFeeCurrency" TEXT;

-- CreateTable
CREATE TABLE "BillingCycle" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "feeAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BillingCycleStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInstallment" (
    "id" TEXT NOT NULL,
    "billingCycleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "sharePercent" INTEGER NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" DATE,
    "reminderDate" DATE,
    "paidAt" TIMESTAMP(3),
    "invoiceNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "billingInstallmentId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amountReceived" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" "BillingPaymentMethod" NOT NULL,
    "reference" TEXT,
    "internalNote" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEmailDelivery" (
    "id" TEXT NOT NULL,
    "billingInstallmentId" TEXT NOT NULL,
    "kind" "BillingEmailKind" NOT NULL,
    "status" "BillingEmailStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingDocumentCounter" (
    "scope" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingDocumentCounter_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE INDEX "BillingCycle_clientId_periodStart_idx" ON "BillingCycle"("clientId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCycle_clientId_periodStart_key" ON "BillingCycle"("clientId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInstallment_invoiceNumber_key" ON "BillingInstallment"("invoiceNumber");

-- CreateIndex
CREATE INDEX "BillingInstallment_status_reminderDate_idx" ON "BillingInstallment"("status", "reminderDate");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInstallment_billingCycleId_sequence_key" ON "BillingInstallment"("billingCycleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_billingInstallmentId_key" ON "BillingPayment"("billingInstallmentId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_receiptNumber_key" ON "BillingPayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "BillingPayment_clientId_paymentDate_idx" ON "BillingPayment"("clientId", "paymentDate");

-- CreateIndex
CREATE INDEX "BillingEmailDelivery_status_idx" ON "BillingEmailDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEmailDelivery_billingInstallmentId_kind_key" ON "BillingEmailDelivery"("billingInstallmentId", "kind");

-- AddForeignKey
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInstallment" ADD CONSTRAINT "BillingInstallment_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_billingInstallmentId_fkey" FOREIGN KEY ("billingInstallmentId") REFERENCES "BillingInstallment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEmailDelivery" ADD CONSTRAINT "BillingEmailDelivery_billingInstallmentId_fkey" FOREIGN KEY ("billingInstallmentId") REFERENCES "BillingInstallment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


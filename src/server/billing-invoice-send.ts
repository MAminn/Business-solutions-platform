"use server";

// ============================================================================
// "Send invoice" — the FIRST installment invoice only.
//
// WHAT THIS COMMIT DOES: bootstraps the first billing cycle and its two
// installments, allocates an invoice number for installment 1, renders the
// approved Loopa PDF once, and emails it to the billing contact — with the
// invoice itself shown in the message body as an inline image rasterized from
// that same PDF, and the PDF attached alongside it.
//
// WHAT IT DELIBERATELY DOES NOT DO: record a payment, write a BillingPayment,
// issue a receipt, send a thank-you or an internal confirmation, or compute
// installment 2's D+15 due date and D+14 reminder date. Installment 2 is
// created with NULL dates on purpose — that clock starts when installment 1 is
// actually PAID, which has not happened here. Nothing in this file may set
// those dates.
//
// ORDERING RULE: the database transaction commits BEFORE any PDF is rendered or
// any SMTP connection is opened. No external I/O ever runs inside a Prisma
// transaction — a slow mail server must not hold database locks, and a failed
// send must not roll back an invoice that has already been numbered.
//
// MONEY: integer piasters end to end, via the committed helpers. Decimals go in
// and out of Prisma as exact strings. No Number()/parseFloat()/toFixed().
//
// DATES: the clock is read exactly ONCE, at the top of the action, and
// immediately converted to an Africa/Cairo civil date. Everything downstream
// uses that single value.
// ============================================================================

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { cairoDayUtc, formatBillingDay } from "@/lib/billing-dates";
import {
  piastersFromDecimalString,
  piastersToDecimalString,
  splitFixedFeePiasters,
} from "@/server/billing-math";
import {
  buildInvoiceEmailSubject,
  buildInvoiceEmailText,
  invoiceFileName,
  type BillingInvoiceInput,
} from "@/server/billing-invoice";
import {
  buildInvoiceInlineEmailHtml,
  invoiceImageCid,
  invoiceImageFileName,
} from "@/server/billing-invoice-email-inline";
import {
  formatBillingInvoiceNumber,
  invoiceCounterScope,
  planFirstInvoice,
} from "@/server/billing-invoice-send.logic";

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

/**
 * Every outcome the UI is allowed to see. `message` is always business copy
 * written here — a raw SMTP error, a transport configuration value, or a Prisma
 * error string never reaches a result object. The underlying detail is stored
 * on BillingEmailDelivery.lastError (sanitized) and logged server-side.
 */
export type SendInvoiceResult =
  | { status: "SENT"; invoiceNumber: string; recipient: string; message: string }
  | {
      status: "ALREADY_SENT";
      invoiceNumber: string | null;
      recipient: string;
      message: string;
    }
  | { status: "IN_PROGRESS"; message: string }
  | {
      status: "DELIVERY_FAILED";
      invoiceNumber: string | null;
      message: string;
    }
  | { status: "BLOCKED"; message: string };

const DELIVERY_FAILED_MESSAGE =
  "Invoice created, but email delivery failed. Retry invoice.";
const IN_PROGRESS_MESSAGE =
  "This invoice is already being sent. Refresh in a moment to see the result.";
const ALREADY_SENT_MESSAGE = "This invoice has already been sent.";

/**
 * A SENDING row older than this is assumed to be a crashed send and may be
 * reclaimed. Shorter than any plausible SMTP timeout, long enough that a slow
 * but live send is never stolen from underneath itself.
 */
const STALE_SENDING_MS = 30 * 60 * 1000;

/** The one email kind this module owns. */
const INVOICE_KIND = "INSTALLMENT_INVOICE" as const;

/** V1 is always a two-installment, 50/50 schedule. */
const INSTALLMENT_COUNT = 2 as const;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/** Exact Prisma Decimal -> integer piasters. `.toString()` is lossless. */
function piastersFromDecimal(value: { toString(): string }): number {
  return piastersFromDecimalString(value.toString());
}

async function assertClientAccess(user: User, clientId: string): Promise<boolean> {
  const accessible = await getAccessibleClientIds(user);
  return accessible.includes(clientId);
}

function revalidateBillingPaths(clientId: string): void {
  revalidatePath(`/clients/${clientId}/billing`);
  revalidatePath(`/clients/${clientId}`);
}

/**
 * Turn any thrown value into a short string safe to persist and to show to an
 * operator. Transport configuration values are substituted out even though they
 * are unlikely to appear, because "unlikely" is not "never" for SMTP libraries
 * that echo the connection back in their errors.
 */
function sanitizeDeliveryError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let text = raw.replace(/\s+/g, " ").trim();

  for (const key of ["SMTP_PASS", "SMTP_USER", "SMTP_HOST", "SMTP_FROM"]) {
    const value = process.env[key];
    if (value && value.length >= 4) {
      text = text.split(value).join("[redacted]");
    }
  }
  // user:password@host inside any URL the transport may have echoed back.
  text = text.replace(/\/\/[^\s/@]+:[^\s/@]+@/g, "//[redacted]@");

  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

// ---------------------------------------------------------------------------
// Invoice number allocation
// ---------------------------------------------------------------------------

/**
 * Allocate the next invoice number for `year`, inside the caller's transaction.
 *
 * ATOMICITY: a single upsert on the BillingDocumentCounter primary key. The
 * create path writes nextValue = 2 because it is simultaneously handing out 1;
 * the update path increments. Both paths therefore return "the value AFTER this
 * allocation", so the allocated sequence is always `nextValue - 1` and the very
 * first invoice of a year is 0001.
 *
 * The counter row is locked for the remainder of the caller's transaction, so a
 * concurrent allocation waits rather than duplicating. If the caller's
 * transaction rolls back, the increment rolls back with it and the number is
 * NOT consumed. Once the transaction commits, the number is permanent: a later
 * SMTP failure never gives it back, and a retry reuses it.
 */
async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  const counter = await tx.billingDocumentCounter.upsert({
    where: { scope: invoiceCounterScope(year) },
    create: { scope: invoiceCounterScope(year), nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return formatBillingInvoiceNumber(year, counter.nextValue - 1);
}

// ---------------------------------------------------------------------------
// Bootstrap: cycle + installments + delivery row, in ONE transaction
// ---------------------------------------------------------------------------

type BootstrapOutcome =
  | { kind: "READY"; deliveryId: string; invoiceNumber: string; recipient: string }
  | { kind: "ALREADY_SENT"; invoiceNumber: string | null; recipient: string }
  | { kind: "BLOCKED"; message: string };

async function bootstrapFirstInvoice(
  tx: Prisma.TransactionClient,
  clientId: string,
  invoiceDay: Date,
): Promise<BootstrapOutcome> {
  // 1. Re-read the billing profile inside the transaction. The page that
  //    rendered the button may be minutes stale.
  const client = await tx.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      billingEnabled: true,
      serviceFeeAmount: true,
      serviceFeeCurrency: true,
      billingContactName: true,
      billingContactEmail: true,
      billingCycleStartDate: true,
    },
  });
  if (!client) {
    return { kind: "BLOCKED", message: "This client no longer exists." };
  }

  const notConfigured = (detail: string): BootstrapOutcome => ({
    kind: "BLOCKED",
    message: `Billing is not configured for this client: ${detail}`,
  });

  if (!client.billingEnabled) return notConfigured("billing is not enabled.");
  if (client.serviceFeeAmount === null) {
    return notConfigured("no monthly service fee is set.");
  }
  if (client.serviceFeeCurrency !== "EGP") {
    return notConfigured("the service fee currency must be EGP.");
  }
  if (!client.billingContactEmail) {
    return notConfigured("no billing contact email is set.");
  }
  if (client.billingCycleStartDate === null) {
    return notConfigured("no billing cycle start date is set.");
  }

  const periodStart = client.billingCycleStartDate;
  if (periodStart.getTime() % 86_400_000 !== 0) {
    return notConfigured("the billing cycle start date is not a civil date.");
  }

  // 2. Determine the cycle. The plan is pure: no clock, no I/O.
  const clientFeePiasters = piastersFromDecimal(client.serviceFeeAmount);
  const plan = planFirstInvoice({
    invoiceDayUtc: invoiceDay,
    periodStartUtc: periodStart,
    totalFeePiasters: clientFeePiasters,
  });

  const cycleSelect = {
    id: true,
    periodStart: true,
    periodEnd: true,
    feeAmount: true,
    currency: true,
    status: true,
  } as const;

  // A P2002 here means a concurrent request won the race; the caller re-runs
  // the whole transaction and this findUnique then succeeds.
  let cycle = await tx.billingCycle.findUnique({
    where: { clientId_periodStart: { clientId: client.id, periodStart } },
    select: cycleSelect,
  });
  if (!cycle) {
    cycle = await tx.billingCycle.create({
      data: {
        clientId: client.id,
        periodStart,
        periodEnd: plan.periodEnd,
        // Snapshot: from here on the CYCLE's fee is authoritative, never the
        // client's current fee, which may be edited at any time.
        feeAmount: piastersToDecimalString(clientFeePiasters),
        currency: client.serviceFeeCurrency,
        status: "OPEN",
      },
      select: cycleSelect,
    });
  }

  if (cycle.status !== "OPEN") {
    return {
      kind: "BLOCKED",
      message:
        cycle.status === "PAID"
          ? "This billing period is already fully paid."
          : "This billing period has been cancelled.",
    };
  }
  if (cycle.currency !== "EGP") {
    return {
      kind: "BLOCKED",
      message: "This billing period is not in EGP and cannot be invoiced.",
    };
  }

  // 3. Split the CYCLE's snapshotted fee, in integer piasters.
  const [firstPiasters, secondPiasters] = splitFixedFeePiasters(
    piastersFromDecimal(cycle.feeAmount),
  );

  // 4. Installment 1 — due on issue, invoice number allocated transactionally.
  const installmentSelect = {
    id: true,
    sequence: true,
    sharePercent: true,
    amountDue: true,
    currency: true,
    status: true,
    dueDate: true,
    invoiceNumber: true,
  } as const;

  let first = await tx.billingInstallment.findUnique({
    where: { billingCycleId_sequence: { billingCycleId: cycle.id, sequence: 1 } },
    select: installmentSelect,
  });

  if (!first) {
    first = await tx.billingInstallment.create({
      data: {
        billingCycleId: cycle.id,
        sequence: 1,
        sharePercent: 50,
        amountDue: piastersToDecimalString(firstPiasters),
        currency: cycle.currency,
        status: "PENDING",
        // V1: the first installment is due the day it is issued.
        dueDate: plan.firstDueDate,
        // Installment 1 has no reminder — the only reminder in the design
        // belongs to installment 2, after payment.
        reminderDate: null,
        invoiceNumber: await allocateInvoiceNumber(
          tx,
          invoiceDay.getUTCFullYear(),
        ),
      },
      select: installmentSelect,
    });
  } else if (first.invoiceNumber === null || first.dueDate === null) {
    // Complete a partially-created row (e.g. a legacy or seeded installment)
    // WITHOUT touching its amount or financial status. A number is allocated
    // only when one is genuinely missing, never on a retry.
    first = await tx.billingInstallment.update({
      where: { id: first.id },
      data: {
        ...(first.invoiceNumber === null
          ? {
              invoiceNumber: await allocateInvoiceNumber(
                tx,
                invoiceDay.getUTCFullYear(),
              ),
            }
          : {}),
        ...(first.dueDate === null ? { dueDate: plan.firstDueDate } : {}),
      },
      select: installmentSelect,
    });
  }

  if (first.status === "CANCELLED") {
    return { kind: "BLOCKED", message: "This installment has been cancelled." };
  }
  if (first.status === "PAID") {
    return {
      kind: "BLOCKED",
      message: "This installment is already paid and cannot be re-invoiced.",
    };
  }

  // 5. Installment 2 — amount only. NO dueDate, NO reminderDate, NO invoice
  //    number. Those come into existence when installment 1 is paid, in a
  //    later commit. Nothing here may compute D+15 or D+14.
  const second = await tx.billingInstallment.findUnique({
    where: { billingCycleId_sequence: { billingCycleId: cycle.id, sequence: 2 } },
    select: { id: true },
  });
  if (!second) {
    await tx.billingInstallment.create({
      data: {
        billingCycleId: cycle.id,
        sequence: 2,
        sharePercent: 50,
        amountDue: piastersToDecimalString(secondPiasters),
        currency: cycle.currency,
        status: "PENDING",
        invoiceNumber: null,
        dueDate: null,
        reminderDate: null,
      },
    });
  }

  // 6. Exactly one delivery row per (installment, kind) — enforced by the
  //    unique constraint, so a double-click can only ever reuse this one.
  const deliverySelect = {
    id: true,
    status: true,
    recipient: true,
  } as const;

  let delivery = await tx.billingEmailDelivery.findUnique({
    where: {
      billingInstallmentId_kind: {
        billingInstallmentId: first.id,
        kind: INVOICE_KIND,
      },
    },
    select: deliverySelect,
  });

  if (!delivery) {
    // The subject is computed from the persisted invoice exactly as the email
    // and PDF will be, so the three can never disagree.
    const subject = buildInvoiceEmailSubject(
      buildInvoiceInput({
        invoiceNumber: first.invoiceNumber as string,
        dueDate: first.dueDate as Date,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        sequence: 1,
        sharePercent: first.sharePercent,
        amountPiasters: piastersFromDecimal(first.amountDue),
        currency: first.currency,
        clientName: client.name,
        billingContactName: client.billingContactName,
      }),
    );

    delivery = await tx.billingEmailDelivery.create({
      data: {
        billingInstallmentId: first.id,
        kind: INVOICE_KIND,
        status: "PENDING",
        // Snapshot at creation: a later edit to the client's billing contact
        // must not silently redirect a retry of THIS invoice.
        recipient: client.billingContactEmail,
        subject,
      },
      select: deliverySelect,
    });
  }

  if (delivery.status === "SENT") {
    return {
      kind: "ALREADY_SENT",
      invoiceNumber: first.invoiceNumber,
      recipient: delivery.recipient,
    };
  }

  return {
    kind: "READY",
    deliveryId: delivery.id,
    invoiceNumber: first.invoiceNumber as string,
    recipient: delivery.recipient,
  };
}

/**
 * Run the bootstrap, re-running the whole transaction on a unique-constraint
 * violation.
 *
 * WHY RE-RUN RATHER THAN CATCH IN PLACE: in PostgreSQL a constraint violation
 * aborts the surrounding transaction, so a P2002 caught inside `tx` leaves a
 * dead transaction in which no further statement can run. Rolling back and
 * replaying is the correct recovery: the replay finds the rows the winning
 * request created and continues on them, and the rolled-back attempt consumes
 * no invoice number.
 *
 * This serializes only the specific rows in conflict — no constraint is
 * relaxed and no global lock is taken.
 */
async function bootstrapWithRetry(
  clientId: string,
  invoiceDay: Date,
): Promise<BootstrapOutcome> {
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await db.$transaction((tx) =>
        bootstrapFirstInvoice(tx, clientId, invoiceDay),
      );
    } catch (err) {
      if (isUniqueViolation(err) && attempt < MAX_ATTEMPTS) {
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error("Invoice bootstrap did not converge");
}

// ---------------------------------------------------------------------------
// Building the invoice from persisted state
// ---------------------------------------------------------------------------

/**
 * Assemble the B-5A presentation input from persisted records only.
 *
 * Every field is read back out of the database rather than recomputed, so the
 * PDF, the email body, and the stored subject describe the same invoice on the
 * first attempt and on every retry — even if the client's fee or billing
 * contact has changed in between.
 */
function buildInvoiceInput(source: {
  invoiceNumber: string;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  sequence: number;
  sharePercent: number;
  amountPiasters: number;
  currency: string;
  clientName: string;
  billingContactName: string | null;
}): BillingInvoiceInput {
  if (source.sequence !== 1 && source.sequence !== 2) {
    throw new Error(`Unsupported installment sequence: ${source.sequence}`);
  }
  if (source.currency !== "EGP") {
    throw new Error(`Unsupported invoice currency: ${source.currency}`);
  }

  return {
    invoiceNumber: source.invoiceNumber,
    // V1: the invoice date and the first installment's due date are the same
    // persisted Cairo civil day — the invoice is due on issue.
    invoiceDate: formatBillingDay(source.dueDate),
    dueDate: formatBillingDay(source.dueDate),
    clientName: source.clientName,
    billingContactName: source.billingContactName,
    servicePeriodStart: formatBillingDay(source.periodStart),
    servicePeriodEnd: formatBillingDay(source.periodEnd),
    installmentSequence: source.sequence,
    installmentCount: INSTALLMENT_COUNT,
    sharePercent: source.sharePercent,
    amountPiasters: source.amountPiasters,
    currency: "EGP",
  };
}

// ---------------------------------------------------------------------------
// Delivery: claim, render, send, record
// ---------------------------------------------------------------------------

/**
 * Compare-and-swap claim on the delivery row.
 *
 * Only the request whose updateMany affects exactly one row is allowed to open
 * an SMTP connection. SENT is never in the claimable set, so a delivered
 * invoice can never be sent twice by this path.
 *
 * MAX_ATTEMPTS IS DELIBERATELY NOT ENFORCED HERE. `attempts` is incremented for
 * the audit trail, but a human pressing Retry is always allowed to try again.
 * The 5-attempt ceiling described in the schema belongs to the future automatic
 * retry/cron behaviour, and manual retry must still work after it gives up.
 */
async function claimDelivery(deliveryId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);

  const claim = await db.billingEmailDelivery.updateMany({
    where: {
      id: deliveryId,
      kind: INVOICE_KIND,
      OR: [
        { status: "PENDING" },
        { status: "FAILED" },
        // Crashed mid-send: reclaimable once it has gone quiet.
        { status: "SENDING", updatedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "SENDING",
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  return claim.count === 1;
}

/** What a lost claim means, decided by re-reading the row. */
async function describeUnclaimed(deliveryId: string): Promise<SendInvoiceResult> {
  const current = await db.billingEmailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      status: true,
      recipient: true,
      installment: { select: { invoiceNumber: true } },
    },
  });

  if (!current) {
    return { status: "BLOCKED", message: "This invoice no longer exists." };
  }
  if (current.status === "SENT") {
    return {
      status: "ALREADY_SENT",
      invoiceNumber: current.installment.invoiceNumber,
      recipient: current.recipient,
      message: ALREADY_SENT_MESSAGE,
    };
  }
  return { status: "IN_PROGRESS", message: IN_PROGRESS_MESSAGE };
}

async function markDeliveryFailed(
  deliveryId: string,
  err: unknown,
): Promise<void> {
  const lastError = sanitizeDeliveryError(err);
  console.error(
    `[billing-invoice-send] delivery failed deliveryId=${deliveryId} error=${lastError}`,
  );
  try {
    await db.billingEmailDelivery.update({
      where: { id: deliveryId },
      data: { status: "FAILED", lastError },
    });
  } catch (writeErr) {
    // The cycle, installments and invoice number all remain committed; only the
    // failure note could not be written. Never rethrow over the original cause.
    console.error(
      `[billing-invoice-send] could not record delivery failure deliveryId=${deliveryId} error=${sanitizeDeliveryError(writeErr)}`,
    );
  }
}

/**
 * Claim, render and send. Assumes the caller has already authenticated and
 * authorized, and that the bootstrap transaction has COMMITTED.
 *
 * A PDF render failure, an image rasterization failure and an SMTP failure all
 * land in the same FAILED branch: from the operator's point of view the invoice
 * exists and simply has not reached the client yet, and Retry is the answer to
 * all three. The cycle, installments and invoice number stay committed.
 */
async function deliverInvoice(deliveryId: string): Promise<SendInvoiceResult> {
  if (!(await claimDelivery(deliveryId))) {
    return describeUnclaimed(deliveryId);
  }

  const delivery = await db.billingEmailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      recipient: true,
      subject: true,
      installment: {
        select: {
          id: true,
          sequence: true,
          sharePercent: true,
          amountDue: true,
          currency: true,
          dueDate: true,
          invoiceNumber: true,
          billingCycle: {
            select: {
              periodStart: true,
              periodEnd: true,
              client: { select: { name: true, billingContactName: true } },
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    return { status: "BLOCKED", message: "This invoice no longer exists." };
  }

  const installment = delivery.installment;
  const cycle = installment.billingCycle;

  try {
    if (installment.invoiceNumber === null) {
      throw new Error("Installment has no invoice number");
    }
    if (installment.dueDate === null) {
      throw new Error("Installment has no due date");
    }

    const input = buildInvoiceInput({
      invoiceNumber: installment.invoiceNumber,
      dueDate: installment.dueDate,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      sequence: installment.sequence,
      sharePercent: installment.sharePercent,
      amountPiasters: piastersFromDecimal(installment.amountDue),
      currency: installment.currency,
      clientName: cycle.client.name,
      billingContactName: cycle.client.billingContactName,
    });

    // Lazy imports keep the PDF renderer and the server-only SMTP transport out
    // of the module graph until an invoice is actually going out.
    const { renderBillingInvoicePdf } = await import(
      "@/server/billing-invoice-doc"
    );

    // ONE render. These exact bytes are both rasterized for the email body and
    // attached as the PDF, so the invoice the client reads in the message and
    // the invoice they download cannot disagree — the image is a decode of the
    // attachment, not a second rendering of the same data.
    const pdf = await renderBillingInvoicePdf(input);

    const { rasterizeInvoicePdf } = await import(
      "@/server/billing-invoice-raster"
    );
    const png = await rasterizeInvoicePdf(pdf);

    const { sendEmail } = await import("@/lib/email");
    const { messageId } = await sendEmail({
      // The STORED recipient, not the client's current email.
      to: delivery.recipient,
      // The STORED subject, so a retry cannot silently re-title the invoice.
      subject: delivery.subject,
      // The body is the complete invoice image and nothing else; every figure
      // is also in the text/plain part for image-blocking clients.
      html: buildInvoiceInlineEmailHtml(input),
      text: buildInvoiceEmailText(input),
      attachments: [
        {
          filename: invoiceImageFileName(input),
          content: png,
          contentType: "image/png",
          cid: invoiceImageCid(input),
          contentDisposition: "inline",
        },
        {
          filename: invoiceFileName(input),
          content: pdf,
          contentType: "application/pdf",
          contentDisposition: "attachment",
        },
      ],
    });

    await db.billingEmailDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SENT",
        messageId,
        sentAt: new Date(),
        lastError: null,
      },
    });

    return {
      status: "SENT",
      invoiceNumber: input.invoiceNumber,
      recipient: delivery.recipient,
      message: `Invoice ${input.invoiceNumber} sent to ${delivery.recipient}.`,
    };
  } catch (err) {
    await markDeliveryFailed(delivery.id, err);
    return {
      status: "DELIVERY_FAILED",
      invoiceNumber: installment.invoiceNumber,
      message: DELIVERY_FAILED_MESSAGE,
    };
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Create the first billing cycle for a client and email installment 1's
 * invoice. Safe to call repeatedly: a second call reuses the cycle, the
 * installments, the invoice number and the delivery row, and refuses outright
 * once the invoice has been sent.
 */
export async function sendFirstInstallmentInvoice(
  clientId: string,
): Promise<SendInvoiceResult> {
  const user = await requireUser();
  if (!(await assertClientAccess(user, clientId))) {
    return {
      status: "BLOCKED",
      message: "You do not have access to this client.",
    };
  }

  // THE ONLY CLOCK READ. Converted to a Cairo civil date immediately; every
  // business date below derives from this single value.
  const now = new Date();
  const invoiceDay = cairoDayUtc(now);

  let bootstrap: BootstrapOutcome;
  try {
    bootstrap = await bootstrapWithRetry(clientId, invoiceDay);
  } catch (err) {
    console.error(
      `[billing-invoice-send] bootstrap failed clientId=${clientId} error=${sanitizeDeliveryError(err)}`,
    );
    return {
      status: "BLOCKED",
      message: "Could not prepare this invoice. Please try again.",
    };
  }

  if (bootstrap.kind === "BLOCKED") {
    return { status: "BLOCKED", message: bootstrap.message };
  }
  if (bootstrap.kind === "ALREADY_SENT") {
    revalidateBillingPaths(clientId);
    return {
      status: "ALREADY_SENT",
      invoiceNumber: bootstrap.invoiceNumber,
      recipient: bootstrap.recipient,
      message: ALREADY_SENT_MESSAGE,
    };
  }

  // The transaction has committed. Only now does anything external happen.
  const result = await deliverInvoice(bootstrap.deliveryId);
  revalidateBillingPaths(clientId);
  return result;
}

/**
 * Re-send an existing installment invoice.
 *
 * Creates nothing and allocates nothing: no cycle, no installment, no invoice
 * number, no payment state. It regenerates the same invoice from the same
 * persisted rows and sends it to the same stored recipient.
 */
export async function retryInstallmentInvoice(
  deliveryId: string,
): Promise<SendInvoiceResult> {
  const user = await requireUser();

  const delivery = await db.billingEmailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      kind: true,
      installment: {
        select: { billingCycle: { select: { clientId: true } } },
      },
    },
  });

  if (!delivery) {
    return { status: "BLOCKED", message: "This invoice no longer exists." };
  }
  if (delivery.kind !== INVOICE_KIND) {
    return {
      status: "BLOCKED",
      message: "This email is not an installment invoice.",
    };
  }

  const clientId = delivery.installment.billingCycle.clientId;
  if (!(await assertClientAccess(user, clientId))) {
    return {
      status: "BLOCKED",
      message: "You do not have access to this client.",
    };
  }

  const result = await deliverInvoice(delivery.id);
  revalidateBillingPaths(clientId);
  return result;
}

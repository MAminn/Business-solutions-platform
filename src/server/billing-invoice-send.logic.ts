// ============================================================================
// Pure planning for the FIRST installment invoice.
//
// Pure and side-effect free: no Prisma, no env, no I/O, no Date.now(). Every
// function here is deterministic given its arguments, so the whole first-invoice
// date and money calculation is unit-testable without a database.
//
// All calendar arithmetic delegates to the committed helpers in
// @/lib/billing-dates (Africa/Cairo civil dates at UTC midnight) and all money
// to @/server/billing-math (integer piasters). Nothing is reimplemented here.
//
// ⚠️ WHAT THIS MODULE DELIBERATELY DOES NOT PRODUCE
//
// There is no second-installment due date and no reminder date. Installment 2's
// D+15 / D+14 clock starts from the date installment 1 is actually PAID, which
// is unknown at invoice time. Producing a placeholder here would be a lie
// written into the schedule, so the planner returns nothing for it at all —
// see the test that asserts the returned object has no such keys.
// ============================================================================

import { addCalendarDays, addCalendarMonths } from "@/lib/billing-dates";
import { splitFixedFeePiasters } from "@/server/billing-math";

/** Prefix of every Loopa service fee invoice number. */
export const INVOICE_NUMBER_PREFIX = "LG-INV";

/** How many digits the running sequence is padded to. */
const INVOICE_SEQUENCE_DIGITS = 4;

/**
 * The service period covered by one monthly cycle: the start date through the
 * day before the same day-of-month one calendar month later.
 *
 *   2026-08-07 -> 2026-09-06
 *   2026-01-31 -> 2026-02-27   (+1 month clamps to Feb 28, then -1 day)
 *   2028-01-31 -> 2028-02-28   (leap year: clamps to Feb 29, then -1 day)
 *
 * Exported separately from the planner so the Billing page can preview the
 * period before any cycle exists, without inventing a second implementation.
 */
export function billingPeriodEndUtc(periodStartUtc: Date): Date {
  return addCalendarDays(addCalendarMonths(periodStartUtc, 1), -1);
}

export interface FirstInvoicePlanInput {
  /** The Cairo civil day the invoice is issued, at UTC midnight. */
  invoiceDayUtc: Date;
  /** Client.billingCycleStartDate, at UTC midnight. */
  periodStartUtc: Date;
  /** The cycle's snapshotted monthly fee, in whole piasters. */
  totalFeePiasters: number;
}

export interface FirstInvoicePlan {
  periodStart: Date;
  periodEnd: Date;
  invoiceDate: Date;
  firstDueDate: Date;
  firstAmountPiasters: number;
  secondAmountPiasters: number;
}

/**
 * Plan the first installment invoice.
 *
 * V1 DATE RULE — the first installment is due on issue. `invoiceDate` and
 * `firstDueDate` are deliberately the SAME Cairo civil day: the client is
 * invoiced and the money is due the moment the invoice goes out. This is a
 * business decision, not an oversight, and the two fields are kept separate so
 * a future payment-terms rule can move the due date without touching anything
 * else.
 *
 * The service period is independent of the invoice day: it always runs from the
 * client's configured billing cycle start date.
 */
export function planFirstInvoice(
  input: FirstInvoicePlanInput,
): FirstInvoicePlan {
  const { invoiceDayUtc, periodStartUtc, totalFeePiasters } = input;

  // billingPeriodEndUtc -> addCalendarMonths asserts UTC midnight on
  // periodStartUtc; assert the invoice day the same way by running it through a
  // no-op day shift, so a raw instant can never slip through as a billing date.
  const invoiceDate = addCalendarDays(invoiceDayUtc, 0);
  const periodStart = addCalendarDays(periodStartUtc, 0);
  const periodEnd = billingPeriodEndUtc(periodStartUtc);

  const [firstAmountPiasters, secondAmountPiasters] =
    splitFixedFeePiasters(totalFeePiasters);

  return {
    periodStart,
    periodEnd,
    invoiceDate,
    firstDueDate: invoiceDate,
    firstAmountPiasters,
    secondAmountPiasters,
  };
}

/**
 * The BillingDocumentCounter scope for invoice numbers issued in `year`, e.g.
 * "INV-2026". The year is the invoice's Cairo civil-date year, so the sequence
 * restarts at 1 on the Cairo new year rather than the UTC one.
 */
export function invoiceCounterScope(year: number): string {
  assertInvoiceYear(year);
  return `INV-${year}`;
}

/**
 * Format an allocated counter value as a human-facing invoice number.
 *
 *   2026, 1  -> "LG-INV-2026-0001"
 *   2026, 42 -> "LG-INV-2026-0042"
 *
 * Sequences past 9999 are NOT truncated — they simply grow wider
 * ("LG-INV-2026-10000"), because silently reusing a number would be far worse
 * than an inconsistent width.
 */
export function formatBillingInvoiceNumber(
  year: number,
  sequence: number,
): string {
  assertInvoiceYear(year);
  if (!Number.isInteger(sequence)) {
    throw new Error("Invoice sequence must be an integer");
  }
  if (sequence < 1) {
    throw new Error("Invoice sequence must be 1 or greater");
  }
  if (!Number.isSafeInteger(sequence)) {
    throw new Error("Invoice sequence is out of range");
  }

  const padded = String(sequence).padStart(INVOICE_SEQUENCE_DIGITS, "0");
  return `${INVOICE_NUMBER_PREFIX}-${year}-${padded}`;
}

/** Four-digit calendar years only — the number embeds the year verbatim. */
function assertInvoiceYear(year: number): void {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`Invalid invoice year: ${JSON.stringify(year)}`);
  }
}

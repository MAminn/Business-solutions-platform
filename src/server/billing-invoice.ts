// ============================================================================
// Loopa installment "Service Fee Invoice" — presentation model + pure builders.
//
// ⚠️ TERMINOLOGY: this document is a SERVICE FEE INVOICE — Loopa's operational
// invoice for its own monthly service fee. It is deliberately NOT a tax
// invoice, VAT invoice, or any official/statutory Egyptian tax document. No VAT
// or tax is calculated, no tax registration is claimed, and no legal company
// identifier is invented. Do not relabel it without implementing the actual
// legal requirements first.
//
// Pure: no Prisma, no I/O, no environment reads, no Date.now(). Everything the
// document shows arrives in the explicit input, so output is deterministic and
// unit-testable. The SAME input shape feeds both the email and the PDF, so the
// two can never disagree about what was invoiced.
//
// MONEY: amounts enter as integer piasters and are formatted through the
// committed helpers in @/server/billing-math. No Number(), parseFloat(),
// toFixed(), or Decimal.toNumber() appears anywhere in this module.
//
// HTML SAFETY: every dynamic value is escaped with `escapeHtml` before it is
// placed into the email body. No client-controlled field is ever inserted as
// raw HTML.
// ============================================================================

import { piastersToDecimalString } from "@/server/billing-math";
import {
  buildEmailShell,
  escapeHtml,
  paragraph,
  detailTable,
  amountCallout,
} from "@/lib/email-shell";

/** The only service description in V1. Not caller-supplied. */
export const SERVICE_DESCRIPTION = "Loopa monthly service fee";

/** Document label. See the terminology note above before changing this. */
export const DOCUMENT_TITLE = "SERVICE FEE INVOICE";

export interface BillingInvoiceInput {
  /** e.g. "LG-INV-2026-0001". Allocated by the caller, never by this module. */
  invoiceNumber: string;
  /** YYYY-MM-DD (Africa/Cairo civil date). */
  invoiceDate: string;
  clientName: string;
  billingContactName?: string | null;
  /** YYYY-MM-DD */
  servicePeriodStart: string;
  /** YYYY-MM-DD */
  servicePeriodEnd: string;
  installmentSequence: 1 | 2;
  installmentCount: 2;
  /** 50 in V1. Percentage billing and custom splits are out of scope. */
  sharePercent: number;
  /** Integer piasters. 1 EGP = 100 piasters. */
  amountPiasters: number;
  currency: "EGP";
  /**
   * YYYY-MM-DD. ALWAYS supplied by the caller. This module never computes a
   * due date — in particular it never derives installment 2's D+15, which does
   * not exist until the first payment is recorded.
   */
  dueDate: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Conservative: the invoice number also becomes part of a filename. */
const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isRealCivilDate(value: string): boolean {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // Date.UTC only — never `new Date(string)`, so no local-timezone shift.
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * Reject anything that must never reach a rendered invoice. Called by every
 * builder AND by the PDF renderer, so an invalid amount or date can never be
 * silently drawn onto a document.
 *
 * NOTE: `Number()` appears in `isRealCivilDate` above for DATE-COMPONENT
 * parsing only. It never touches a monetary value — money is validated as an
 * integer piaster count and formatted only via piastersToDecimalString.
 */
export function assertValidInvoiceInput(input: BillingInvoiceInput): void {
  if (!INVOICE_NUMBER_PATTERN.test(input.invoiceNumber)) {
    throw new Error(`Invalid invoiceNumber: ${JSON.stringify(input.invoiceNumber)}`);
  }
  if (typeof input.clientName !== "string" || input.clientName.trim() === "") {
    throw new Error("clientName is required");
  }
  for (const [label, value] of [
    ["invoiceDate", input.invoiceDate],
    ["servicePeriodStart", input.servicePeriodStart],
    ["servicePeriodEnd", input.servicePeriodEnd],
    ["dueDate", input.dueDate],
  ] as const) {
    if (!isRealCivilDate(value)) {
      throw new Error(`${label} must be a real YYYY-MM-DD date, got ${JSON.stringify(value)}`);
    }
  }
  if (input.servicePeriodEnd < input.servicePeriodStart) {
    // Safe as a string comparison: YYYY-MM-DD sorts lexicographically.
    throw new Error("servicePeriodEnd must not precede servicePeriodStart");
  }
  if (input.installmentSequence !== 1 && input.installmentSequence !== 2) {
    throw new Error("installmentSequence must be 1 or 2");
  }
  if (input.installmentCount !== 2) {
    throw new Error("installmentCount must be 2 in V1");
  }
  if (!Number.isInteger(input.sharePercent) || input.sharePercent !== 50) {
    throw new Error("sharePercent must be 50 in V1");
  }
  if (
    typeof input.amountPiasters !== "number" ||
    !Number.isSafeInteger(input.amountPiasters) ||
    input.amountPiasters < 0
  ) {
    throw new Error("amountPiasters must be a non-negative safe integer");
  }
  if (input.currency !== "EGP") {
    throw new Error("currency must be EGP in V1");
  }
}

// ---------------------------------------------------------------------------
// Pure presentation helpers
// ---------------------------------------------------------------------------

/** Group an integer-part string with thousands separators. String-only. */
function groupThousands(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Exact money display straight from integer piasters.
 *   500000 -> "EGP 5,000.00"
 *   500001 -> "EGP 5,000.01"
 * No floating point at any step.
 */
export function formatInvoiceAmount(
  amountPiasters: number,
  currency: string,
): string {
  const decimal = piastersToDecimalString(amountPiasters);
  const [whole, fraction] = decimal.split(".");
  return `${currency} ${groupThousands(whole)}.${fraction}`;
}

/** "Installment 1 of 2" */
export function installmentLabel(sequence: number, count: number): string {
  return `Installment ${sequence} of ${count}`;
}

/** "Installment 1 of 2 · 50%" */
export function installmentLabelWithShare(input: BillingInvoiceInput): string {
  return `${installmentLabel(input.installmentSequence, input.installmentCount)} · ${input.sharePercent}%`;
}

/**
 * "2026-08-07 to 2026-09-06"
 *
 * ASCII-only separator on purpose. The PDF embeds a Noto Sans Arabic subset,
 * which has NO glyph for "→" (U+2192) — a visual smoke test of the rendered
 * PDF showed the arrow silently falling back to a stray apostrophe. Any
 * character used here must exist in that font, so the word "to" is used
 * instead of an arrow or a dash.
 */
export function servicePeriodLabel(input: BillingInvoiceInput): string {
  return `${input.servicePeriodStart} to ${input.servicePeriodEnd}`;
}

/**
 * Filesystem- and header-safe attachment filename. Derived only from the
 * invoice number, which is already restricted to a conservative charset, so no
 * client-controlled text can influence it.
 */
export function invoiceFileName(input: BillingInvoiceInput): string {
  assertValidInvoiceInput(input);
  const safe = input.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-");
  return `loopa-service-fee-invoice-${safe}.pdf`;
}

/** e.g. "Loopa service fee invoice · EGP 5,000.00 · Mach" */
export function buildInvoiceEmailSubject(input: BillingInvoiceInput): string {
  assertValidInvoiceInput(input);
  const amount = formatInvoiceAmount(input.amountPiasters, input.currency);
  // Subjects are plain text: never HTML-escaped, and never HTML.
  return `Loopa service fee invoice · ${amount} · ${input.clientName}`;
}

// ---------------------------------------------------------------------------
// Email bodies
// ---------------------------------------------------------------------------

function greetingName(input: BillingInvoiceInput): string {
  const contact = input.billingContactName?.trim();
  return contact && contact.length > 0 ? contact : input.clientName;
}

/**
 * Transactional invoice email. Business tone, no marketing language.
 *
 * Deliberately contains NO payment link, NO bank details, and NO payment
 * instructions — none are configured, and inventing them would be worse than
 * omitting them.
 *
 * For installment 1 this says nothing about installment 2's date: that date
 * does not exist until the first payment is recorded, so claiming one would be
 * a lie. For installment 2 the caller-supplied `dueDate` is simply rendered;
 * this module never calculates it.
 */
export function buildInvoiceEmailHtml(input: BillingInvoiceInput): string {
  assertValidInvoiceInput(input);

  const amount = formatInvoiceAmount(input.amountPiasters, input.currency);
  const rows: Array<[string, string]> = [
    ["Invoice number", input.invoiceNumber],
    ["Invoice date", input.invoiceDate],
    ["Client", input.clientName],
    ["Service", SERVICE_DESCRIPTION],
    ["Service period", servicePeriodLabel(input)],
    ["Installment", installmentLabelWithShare(input)],
    ["Due date", input.dueDate],
  ];

  // Every dynamic value below goes through the escaping helpers in
  // email-shell.ts (paragraph / detailTable / amountCallout each escape their
  // own arguments). Nothing client-controlled is concatenated as raw HTML.
  const bodyHtml = [
    paragraph(`Hello ${greetingName(input)},`),
    paragraph(
      `Please find attached the Loopa service fee invoice for ${servicePeriodLabel(input)}.`,
    ),
    amountCallout("Amount due", amount),
    detailTable(rows),
    paragraph(
      "The attached PDF contains the service fee invoice for your records.",
    ),
    paragraph("Thank you."),
  ].join("\n");

  return buildEmailShell({
    preheader: `${amount} due ${input.dueDate} · invoice ${input.invoiceNumber}`,
    eyebrow: "Service fee invoice",
    title: `Service fee invoice ${input.invoiceNumber}`,
    bodyHtml,
    footerText: `${installmentLabel(input.installmentSequence, input.installmentCount)} · ${SERVICE_DESCRIPTION}.`,
  });
}

/**
 * Plain-text alternative for a future sendEmail `text` part. No HTML, no
 * escaping needed — this is never interpreted as markup.
 */
export function buildInvoiceEmailText(input: BillingInvoiceInput): string {
  assertValidInvoiceInput(input);
  const amount = formatInvoiceAmount(input.amountPiasters, input.currency);

  return [
    `Hello ${greetingName(input)},`,
    ``,
    `Please find attached the Loopa service fee invoice for ${servicePeriodLabel(input)}.`,
    ``,
    `Amount due: ${amount}`,
    ``,
    `Invoice number: ${input.invoiceNumber}`,
    `Invoice date:   ${input.invoiceDate}`,
    `Client:         ${input.clientName}`,
    `Service:        ${SERVICE_DESCRIPTION}`,
    `Service period: ${servicePeriodLabel(input)}`,
    `Installment:    ${installmentLabelWithShare(input)}`,
    `Due date:       ${input.dueDate}`,
    ``,
    `The attached PDF contains the service fee invoice for your records.`,
    ``,
    `Thank you.`,
    `Loopa`,
  ].join("\n");
}

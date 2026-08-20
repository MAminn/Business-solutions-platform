/**
 * Source-agnostic normalizers shared by every order adapter.
 *
 * Everything here is a PURE function over verbatim source strings. Nothing
 * reads the database, and nothing here is allowed to see PII - callers pass
 * only allowlisted fields.
 *
 * Design rule throughout: an unrecognised input produces an explicit `UNKNOWN`
 * plus a surfaced issue. It never silently falls back to a plausible-looking
 * default, because a wrong-but-plausible payment state is far more expensive
 * than a visibly unknown one.
 */

import type {
  OrderFulfillmentState,
  OrderPaymentMethod,
  OrderPaymentState,
} from "./types";

// ---------------------------------------------------------------------------
// Match key
// ---------------------------------------------------------------------------

/**
 * Derive the carrier-matching key from a human order number.
 *
 * `#5402` -> `5402`. Strips a leading `#`, trims, lowercases, and collapses
 * internal whitespace runs to a single space.
 *
 * Lowercasing matters because some stores prefix order names with letters
 * (`EG#5402`, `mach-5402`) and a carrier's merchant reference will not
 * reliably preserve case. Whitespace collapsing matters because references are
 * frequently re-keyed by hand into courier dashboards.
 *
 * Returns "" for an empty order number; callers treat that as unmatchable and
 * report it rather than emitting a blank key that would collide with itself.
 */
export function deriveMatchKey(orderNumber: string): string {
  return orderNumber
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Trim, and collapse an empty string to null. Source blanks are absences. */
export function cleanString(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Keep a decimal money string verbatim (e.g. `"2569.00"`), or null if blank.
 *
 * Deliberately NOT parsed to `number`: binary floating point cannot represent
 * decimal currency exactly, and the eventual column is `Decimal(12,2)`. The
 * string is validated for shape so a malformed value is caught here rather than
 * at insert time, but it is never reformatted - the source's own precision is
 * preserved.
 */
export function cleanMoney(value: string | undefined | null): string | null {
  const raw = cleanString(value);
  if (raw === null) return null;
  // Optional sign, digits, optional decimal part. Thousands separators are not
  // expected from Shopify exports and are rejected rather than guessed at.
  return /^-?\d+(\.\d+)?$/.test(raw) ? raw : null;
}

/** Parse a money string for COMPARISON only. Never use the result for storage. */
export function moneyToNumber(value: string | null): number {
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Parse a Shopify CSV timestamp into a UTC instant.
 *
 * Shopify writes the store's local time with an explicit offset and a space
 * separator: `2026-08-20 18:26:35 +0300`. That is not ISO 8601, so passing it
 * straight to `new Date()` is engine-dependent. This normalizes it to
 * `2026-08-20T18:26:35+03:00` first.
 *
 * The offset must be preserved, not assumed: reading `18:26` as UTC would shift
 * every Egyptian order back three hours and silently move late-evening orders
 * to the previous day, corrupting any day-grained join against ad spend.
 *
 * Returns null for blank or unparseable input; callers surface an issue.
 */
export function parseSourceTimestamp(value: string | undefined | null): Date | null {
  const raw = cleanString(value);
  if (raw === null) return null;

  const match = raw.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})?$/,
  );

  let candidate: string;
  if (match) {
    const [, date, time, offsetHours, offsetMinutes = "00"] = match;
    const seconds = time.length === 5 ? `${time}:00` : time;
    candidate = `${date}T${seconds}${offsetHours}:${offsetMinutes}`;
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) {
    // Same layout with no offset at all. Treat as UTC rather than as local
    // machine time, so the result does not depend on where the code runs.
    candidate = `${raw.replace(" ", "T")}Z`;
  } else {
    candidate = raw;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Split a Shopify `Tags` value into trimmed tags, preserving each verbatim.
 *
 * The field is comma-delimited INSIDE a single quoted CSV cell, so it only
 * arrives intact if the CSV tokenizer honoured quoting. Empty entries are
 * dropped; nothing else is altered - casing, emoji, and Arabic are preserved,
 * because tags are matched later against merchant-defined vocabulary.
 */
export function splitTags(value: string | undefined | null): string[] {
  const raw = cleanString(value);
  if (raw === null) return [];
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

// ---------------------------------------------------------------------------
// Payment method
// ---------------------------------------------------------------------------

/**
 * COD detection patterns, matched against a casefolded, punctuation-stripped
 * gateway name. Ordered most- to least-specific.
 *
 * `Payment Method` is a merchant-configurable gateway DISPLAY name, so this is
 * necessarily a pattern list rather than an enum lookup. The observed sample
 * value is `Cash on Delivery (COD)`.
 */
const COD_PATTERNS = [
  "cash on delivery",
  "cash_on_delivery",
  "cashondelivery",
  "cash on deliver",
  "cod",
  // Arabic: "payment on receipt", with and without the definite article, and
  // with the common ha/ta-marbuta orthographic variance.
  "الدفع عند الاستلام",
  "الدفع عند الاستلم",
  "دفع عند الاستلام",
  "الدفع عند التسليم",
];

const CARD_PATTERNS = [
  "credit card",
  "debit card",
  "card",
  "visa",
  "mastercard",
  "meeza",
  "stripe",
  "checkout com",
  "shopify payments",
];

/**
 * Recognised payment aggregators, mostly Egyptian.
 *
 * These name a GATEWAY, not an instrument. Each routes to some mix of cards,
 * Meeza, mobile wallets, Fawry, bank installments, and in several cases cash
 * collection - and the order record says only which gateway was used. They
 * therefore resolve to `GATEWAY`, never to `CARD`.
 *
 * `paymob` was previously classified as `CARD`. It is an aggregator of exactly
 * the same kind as Fawaterak, so that was an overclaim of the same sort; it is
 * moved here for consistency. No test or caller depended on the old value.
 */
const GATEWAY_PATTERNS = [
  "fawaterak",
  "fawaterk",
  "paymob",
  "accept com",
  "kashier",
  "paytabs",
  "pay tabs",
  "geidea",
  "opay",
  "myfatoorah",
  "my fatoorah",
  "amazon payment services",
  "payfort",
  "paycoo",
  "tap payments",
  "xpay",
];

const WALLET_PATTERNS = [
  "vodafone cash",
  "orange money",
  "etisalat cash",
  "we pay",
  "wallet",
  "valu",
  "fawry",
  "paypal",
  "apple pay",
  "google pay",
];

const BANK_PATTERNS = ["bank transfer", "bank deposit", "instapay", "wire transfer"];

const GIFT_CARD_PATTERNS = ["gift card", "gift_card", "store credit"];

/** Casefold and strip punctuation so `Cash on Delivery (COD)` matches cleanly. */
function foldGatewayName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()\[\]{}.,;:!?/\\|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(folded: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === "cod") {
      // Word-boundary match only: substring matching would classify a gateway
      // named "Codashop" or "Cod Bank" as cash on delivery.
      return /\bcod\b/.test(folded);
    }
    return folded.includes(pattern);
  });
}

export interface PaymentMethodResult {
  method: OrderPaymentMethod;
  /**
   * True when ANY gateway token in a split payment resolved to COD. A split
   * payment is reported rather than silently reduced to its first gateway.
   */
  isCod: boolean;
  /** Individual gateway tokens, when the source listed more than one. */
  tokens: string[];
  /** True when the value was non-empty but matched no known pattern. */
  unrecognized: boolean;
}

/**
 * Normalize a gateway display name to a payment method.
 *
 * Split payments arrive comma-joined. Each token is classified independently;
 * if any is COD the order is flagged COD, because COD exposure is the fact that
 * matters operationally even on a partially prepaid order.
 */
export function normalizePaymentMethod(
  value: string | undefined | null,
): PaymentMethodResult {
  const raw = cleanString(value);
  if (raw === null) {
    return { method: "UNKNOWN", isCod: false, tokens: [], unrecognized: false };
  }

  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  // Order matters. COD is checked FIRST and unconditionally: an aggregator can
  // route to cash collection, so a label naming COD outright must never be
  // reduced to the gateway that carried it.
  //
  // GATEWAY is checked LAST of the known buckets, because it means "instrument
  // unspecified". When a label names both a gateway and an instrument
  // ("Paymob - Visa"), the instrument IS specified, so the more informative
  // `CARD` wins and `GATEWAY`'s definition simply does not apply.
  const classified = tokens.map((token): OrderPaymentMethod => {
    const folded = foldGatewayName(token);
    if (matchesAny(folded, COD_PATTERNS)) return "COD";
    if (matchesAny(folded, WALLET_PATTERNS)) return "WALLET";
    if (matchesAny(folded, BANK_PATTERNS)) return "BANK_TRANSFER";
    if (matchesAny(folded, GIFT_CARD_PATTERNS)) return "GIFT_CARD";
    if (matchesAny(folded, CARD_PATTERNS)) return "CARD";
    if (matchesAny(folded, GATEWAY_PATTERNS)) return "GATEWAY";
    return "UNKNOWN";
  });

  const isCod = classified.includes("COD");
  const unrecognized = classified.every((method) => method === "UNKNOWN");

  let method: OrderPaymentMethod;
  if (isCod) {
    method = "COD";
  } else if (unrecognized) {
    method = "UNKNOWN";
  } else {
    const known = classified.filter((entry) => entry !== "UNKNOWN");
    // A genuinely mixed prepaid split has no single truthful answer; `OTHER`
    // says so rather than picking a winner.
    const allSame = known.every((entry) => entry === known[0]);
    method = allSame ? known[0] : "OTHER";
  }

  return { method, isCod, tokens, unrecognized };
}

// ---------------------------------------------------------------------------
// Payment state
// ---------------------------------------------------------------------------

/**
 * Shopify `Financial Status` vocabulary. An explicit table, not a heuristic:
 * an unlisted value must surface as `UNKNOWN` so it gets noticed and added,
 * rather than being coerced into whichever member looks closest.
 */
const FINANCIAL_STATUS_MAP: Record<string, OrderPaymentState> = {
  pending: "PENDING",
  authorized: "AUTHORIZED",
  paid: "PAID",
  partially_paid: "AUTHORIZED",
  "partially paid": "AUTHORIZED",
  partially_refunded: "PARTIALLY_REFUNDED",
  "partially refunded": "PARTIALLY_REFUNDED",
  refunded: "REFUNDED",
  voided: "VOIDED",
  expired: "VOIDED",
  unpaid: "PENDING",
};

export interface PaymentStateResult {
  state: OrderPaymentState;
  /** True when a non-empty financial status matched no known value. */
  unrecognized: boolean;
}

/**
 * Derive payment state from the financial status and the refunded amount.
 *
 * Precedence: the refunded AMOUNT outranks the status string. A number is
 * unambiguous where a status label is a summary, and a partial refund that has
 * not yet updated the label would otherwise be reported as fully paid.
 *
 * Note for COD stores: `pending` here is the NORMAL state for a healthy order,
 * not a problem. Filtering revenue on `PAID` would report zero.
 */
export function normalizePaymentState(input: {
  financialStatus: string | null;
  refundedAmount: string | null;
  totalAmount: string | null;
}): PaymentStateResult {
  const refunded = moneyToNumber(input.refundedAmount);
  const total = moneyToNumber(input.totalAmount);

  if (refunded > 0) {
    // A refund at or above the total is a full refund; anything less is partial
    // regardless of what the status label currently says.
    return {
      state: total > 0 && refunded >= total ? "REFUNDED" : "PARTIALLY_REFUNDED",
      unrecognized: false,
    };
  }

  const status = cleanString(input.financialStatus);
  if (status === null) {
    return { state: "UNKNOWN", unrecognized: false };
  }

  const mapped = FINANCIAL_STATUS_MAP[status.toLowerCase()];
  if (mapped === undefined) {
    return { state: "UNKNOWN", unrecognized: true };
  }

  return { state: mapped, unrecognized: false };
}

// ---------------------------------------------------------------------------
// Fulfillment state
// ---------------------------------------------------------------------------

/** Shopify `Fulfillment Status` vocabulary. Blank means unfulfilled. */
const FULFILLMENT_STATUS_MAP: Record<string, OrderFulfillmentState> = {
  fulfilled: "FULFILLED",
  partial: "PARTIALLY_FULFILLED",
  partially_fulfilled: "PARTIALLY_FULFILLED",
  "partially fulfilled": "PARTIALLY_FULFILLED",
  unfulfilled: "UNFULFILLED",
  restocked: "RETURNED",
};

export interface FulfillmentStateResult {
  state: OrderFulfillmentState;
  unrecognized: boolean;
}

/**
 * Derive fulfillment state.
 *
 * Precedence:
 *   1. `Cancelled at` present -> CANCELLED. Highest precedence: Shopify leaves
 *      the fulfillment status untouched on cancellation, so a cancelled order
 *      can still read `fulfilled`.
 *   2. `Fulfillment Status`, via the explicit table above.
 *   3. `Fulfilled at` present with a blank status -> FULFILLED. Trust the
 *      timestamp: a concrete event outranks a missing label.
 *   4. Otherwise UNFULFILLED.
 *
 * Tags are NOT consulted, by design - see `NormalizedOrder.tags`.
 */
export function normalizeFulfillmentState(input: {
  fulfillmentStatus: string | null;
  cancelledAt: Date | null;
  fulfilledAt: Date | null;
}): FulfillmentStateResult {
  if (input.cancelledAt !== null) {
    return { state: "CANCELLED", unrecognized: false };
  }

  const status = cleanString(input.fulfillmentStatus);
  if (status !== null) {
    const mapped = FULFILLMENT_STATUS_MAP[status.toLowerCase()];
    if (mapped === undefined) {
      return { state: "UNFULFILLED", unrecognized: true };
    }
    return { state: mapped, unrecognized: false };
  }

  if (input.fulfilledAt !== null) {
    return { state: "FULFILLED", unrecognized: false };
  }

  return { state: "UNFULFILLED", unrecognized: false };
}

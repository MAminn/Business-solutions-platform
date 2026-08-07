// ============================================================================
// Integer-piaster money helpers for client billing.
//
// Pure and side-effect free: no I/O, no DB, no env. Deterministic given inputs.
//
// THE CORE RULE: 1 EGP = 100 piasters, and every monetary calculation happens
// in whole piasters as a JavaScript integer. Floating point never participates
// in a split, a sum, or a balance — `parseFloat` is deliberately not used
// anywhere in this module, because e.g. 4.35 * 100 is 434.99999999999994 in
// binary floating point (and 8.22 * 100 is 822.0000000000001), so a float-based
// parser silently loses or gains a piaster depending on the value. A fee split
// must never depend on rounding luck.
//
// Storage stays Decimal(12, 2) in Postgres (matching monthlyBudget / minCpa and
// the @/lib/format helpers). These helpers are the boundary: a decimal string
// becomes piasters on the way in, and piasters become a decimal string on the
// way out. Fractional piasters can therefore never be constructed, let alone
// stored.
//
// The fixed 50/50 split gives any odd piaster to installment 1, so that
// installment 1 + installment 2 reconstructs the fee exactly:
//   EGP 10,000.01 -> EGP 5,000.01 + EGP 5,000.00
// ============================================================================

/**
 * Strict decimal grammar. Up to 10 integer digits and at most 2 fractional
 * digits, mirroring the Decimal(12, 2) column exactly (precision 12, scale 2 =>
 * max 9,999,999,999.99), so this accepts precisely what the database can store.
 *
 * Deliberately rejects: signs ("-5", "+5"), exponent notation ("1e4"),
 * whitespace-only and empty strings, a bare "." or ".5", trailing "." ("5."),
 * and more than 2 decimal places ("10000.001") — which Decimal(12, 2) would
 * otherwise silently round on write.
 */
const DECIMAL_AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/** Largest value these helpers accept, in piasters (Decimal(12, 2) maximum). */
const MAX_PIASTERS = 999_999_999_999;

function assertPiasters(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer number of piasters`);
  }
  if (value < 0) {
    throw new Error(`${label} must not be negative`);
  }
  return value;
}

/**
 * Parse an EGP decimal string into whole piasters.
 *
 *   "10000"     -> 1000000
 *   "10000.01"  -> 1000001
 *   "10000.1"   -> 1000010   (one decimal place means tenths, i.e. 10 piasters)
 *   "0.05"      -> 5
 *
 * String parsing only — never parseFloat.
 */
export function piastersFromDecimalString(value: string): number {
  if (typeof value !== "string") {
    throw new Error("Amount must be a string");
  }

  const match = DECIMAL_AMOUNT_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(
      `Not a valid EGP amount: ${JSON.stringify(value)} ` +
        `(expected up to 10 digits with at most 2 decimal places)`,
    );
  }

  const whole = Number(match[1]);
  // "1" means one tenth of a pound = 10 piasters, so pad right, not left.
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));

  const piasters = whole * 100 + fraction;
  if (!Number.isSafeInteger(piasters) || piasters > MAX_PIASTERS) {
    throw new Error(`Amount out of range: ${value}`);
  }
  return piasters;
}

/**
 * Render whole piasters as the exact decimal string to hand to Prisma's Decimal.
 * Always two decimal places.
 *
 *   1000001 -> "10000.01"
 *    500000 -> "5000.00"
 *         5 -> "0.05"
 */
export function piastersToDecimalString(piasters: number): string {
  assertPiasters(piasters, "piasters");

  const whole = Math.floor(piasters / 100);
  const fraction = piasters % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * The fixed 50/50 installment split, in whole piasters.
 *
 * When the total is odd the extra piaster goes to installment 1, so the client
 * is never asked for a fraction and the two installments always reconstruct the
 * fee exactly: first + second === totalPiasters, for every input.
 *
 *   1000000 -> [500000, 500000]
 *   1000001 -> [500001, 500000]
 *         1 -> [1, 0]
 *         0 -> [0, 0]
 *
 * Percentage billing and custom installment percentages are out of scope; this
 * function is intentionally not parameterised by a percentage.
 */
export function splitFixedFeePiasters(
  totalPiasters: number,
): [number, number] {
  assertPiasters(totalPiasters, "totalPiasters");

  const second = Math.floor(totalPiasters / 2);
  const first = totalPiasters - second;
  return [first, second];
}

/**
 * Sum whole piasters, rejecting invalid entries and any result that leaves the
 * safe-integer range. Used for "amount received" (and, by subtraction from the
 * cycle fee, the outstanding balance) — both of which are always derived from
 * payment rows and never stored.
 */
export function sumPiasters(values: number[]): number {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array of piaster amounts");
  }

  let total = 0;
  for (let i = 0; i < values.length; i++) {
    assertPiasters(values[i], `values[${i}]`);
    total += values[i];
    if (!Number.isSafeInteger(total)) {
      throw new Error("Sum exceeds the safe integer range");
    }
  }
  return total;
}

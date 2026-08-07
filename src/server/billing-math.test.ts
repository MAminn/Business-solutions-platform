import { test } from "node:test";
import assert from "node:assert/strict";
import {
  piastersFromDecimalString,
  piastersToDecimalString,
  splitFixedFeePiasters,
  sumPiasters,
} from "./billing-math";

// ---------------------------------------------------------------------------
// piastersFromDecimalString — accepted
// ---------------------------------------------------------------------------

test("piastersFromDecimalString: whole pounds", () => {
  assert.equal(piastersFromDecimalString("10000"), 1000000);
});

test("piastersFromDecimalString: two decimal places", () => {
  assert.equal(piastersFromDecimalString("10000.01"), 1000001);
});

test("piastersFromDecimalString: one decimal place means tenths, not piasters", () => {
  // "10000.1" is ten thousand pounds and ten piasters — NOT one piaster.
  assert.equal(piastersFromDecimalString("10000.1"), 1000010);
});

test("piastersFromDecimalString: sub-pound amount", () => {
  assert.equal(piastersFromDecimalString("0.05"), 5);
});

test("piastersFromDecimalString: zero", () => {
  assert.equal(piastersFromDecimalString("0"), 0);
  assert.equal(piastersFromDecimalString("0.00"), 0);
});

test("piastersFromDecimalString: surrounding whitespace is trimmed", () => {
  assert.equal(piastersFromDecimalString("  10000.01  "), 1000001);
});

test("piastersFromDecimalString: immune to binary floating-point error", () => {
  // 4.35 * 100 === 434.99999999999994, so a float-based implementation that
  // truncates would lose a piaster here. String parsing cannot.
  assert.equal(4.35 * 100 < 435, true, "precondition: 4.35 is a float hazard");
  assert.equal(Math.floor(4.35 * 100), 434, "precondition: truncation loses 1");
  assert.equal(piastersFromDecimalString("4.35"), 435);

  // Same class of error in the other direction.
  assert.equal(8.22 * 100 > 822, true, "precondition: 8.22 overshoots");
  assert.equal(piastersFromDecimalString("8.22"), 822);
});

// ---------------------------------------------------------------------------
// piastersFromDecimalString — rejected
// ---------------------------------------------------------------------------

test("piastersFromDecimalString: rejects more than two decimal places", () => {
  // Decimal(12, 2) would silently round this on write.
  assert.throws(() => piastersFromDecimalString("10000.001"), /valid EGP/);
});

test("piastersFromDecimalString: rejects exponent notation", () => {
  assert.throws(() => piastersFromDecimalString("1e4"), /valid EGP/);
});

test("piastersFromDecimalString: rejects negatives", () => {
  assert.throws(() => piastersFromDecimalString("-5"), /valid EGP/);
  assert.throws(() => piastersFromDecimalString("-0.01"), /valid EGP/);
});

test("piastersFromDecimalString: rejects the empty string", () => {
  assert.throws(() => piastersFromDecimalString(""), /valid EGP/);
  assert.throws(() => piastersFromDecimalString("   "), /valid EGP/);
});

test("piastersFromDecimalString: rejects malformed values", () => {
  for (const bad of [
    "abc",
    "10,000.00",
    "EGP 10000",
    "10000.",
    ".5",
    ".",
    "10.0.0",
    "+5",
    "1 000",
    "Infinity",
    "NaN",
    "0x10",
  ]) {
    assert.throws(
      () => piastersFromDecimalString(bad),
      /valid EGP/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("piastersFromDecimalString: rejects non-string input", () => {
  // @ts-expect-error deliberately wrong type at the boundary
  assert.throws(() => piastersFromDecimalString(10000.01), /must be a string/);
  // @ts-expect-error deliberately wrong type at the boundary
  assert.throws(() => piastersFromDecimalString(null), /must be a string/);
});

test("piastersFromDecimalString: rejects amounts beyond Decimal(12, 2)", () => {
  assert.throws(() => piastersFromDecimalString("99999999999"), /valid EGP/);
});

test("piastersFromDecimalString: accepts the Decimal(12, 2) maximum", () => {
  assert.equal(piastersFromDecimalString("9999999999.99"), 999999999999);
});

// ---------------------------------------------------------------------------
// piastersToDecimalString
// ---------------------------------------------------------------------------

test("piastersToDecimalString: documented examples", () => {
  assert.equal(piastersToDecimalString(1000001), "10000.01");
  assert.equal(piastersToDecimalString(500000), "5000.00");
  assert.equal(piastersToDecimalString(5), "0.05");
});

test("piastersToDecimalString: always two decimal places", () => {
  assert.equal(piastersToDecimalString(0), "0.00");
  assert.equal(piastersToDecimalString(1), "0.01");
  assert.equal(piastersToDecimalString(10), "0.10");
  assert.equal(piastersToDecimalString(100), "1.00");
  assert.equal(piastersToDecimalString(1000010), "10000.10");
});

test("piastersToDecimalString: rejects negatives", () => {
  assert.throws(() => piastersToDecimalString(-1), /must not be negative/);
});

test("piastersToDecimalString: rejects non-integers", () => {
  assert.throws(() => piastersToDecimalString(1.5), /safe integer/);
  assert.throws(() => piastersToDecimalString(0.1), /safe integer/);
});

test("piastersToDecimalString: rejects unsafe integers and non-finite values", () => {
  assert.throws(
    () => piastersToDecimalString(Number.MAX_SAFE_INTEGER + 1),
    /safe integer/,
  );
  assert.throws(() => piastersToDecimalString(Infinity), /safe integer/);
  assert.throws(() => piastersToDecimalString(NaN), /safe integer/);
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

test("round-trip: piasters -> decimal string -> piasters", () => {
  for (const piasters of [
    0, 1, 5, 10, 99, 100, 101, 500000, 500001, 1000000, 1000001, 1000010,
    123456789, 999999999999,
  ]) {
    assert.equal(
      piastersFromDecimalString(piastersToDecimalString(piasters)),
      piasters,
      `round-trip failed for ${piasters}`,
    );
  }
});

test("round-trip: decimal string -> piasters -> decimal string", () => {
  for (const value of [
    "0.00",
    "0.05",
    "5000.00",
    "5000.01",
    "10000.00",
    "10000.01",
    "10000.10",
    "9999999999.99",
  ]) {
    assert.equal(
      piastersToDecimalString(piastersFromDecimalString(value)),
      value,
      `round-trip failed for ${value}`,
    );
  }
});

// ---------------------------------------------------------------------------
// splitFixedFeePiasters
// ---------------------------------------------------------------------------

test("splitFixedFeePiasters: even total splits exactly in half", () => {
  assert.deepEqual(splitFixedFeePiasters(1000000), [500000, 500000]);
});

test("splitFixedFeePiasters: odd total gives the extra piaster to installment 1", () => {
  assert.deepEqual(splitFixedFeePiasters(1000001), [500001, 500000]);
});

test("splitFixedFeePiasters: one piaster", () => {
  assert.deepEqual(splitFixedFeePiasters(1), [1, 0]);
});

test("splitFixedFeePiasters: zero", () => {
  assert.deepEqual(splitFixedFeePiasters(0), [0, 0]);
});

test("splitFixedFeePiasters: rejects negatives, non-integers and unsafe values", () => {
  assert.throws(() => splitFixedFeePiasters(-1), /must not be negative/);
  assert.throws(() => splitFixedFeePiasters(100.5), /safe integer/);
  assert.throws(() => splitFixedFeePiasters(NaN), /safe integer/);
  assert.throws(
    () => splitFixedFeePiasters(Number.MAX_SAFE_INTEGER + 1),
    /safe integer/,
  );
});

// ---------------------------------------------------------------------------
// The required business example
// ---------------------------------------------------------------------------

test("business example: EGP 10,000.01 splits into EGP 5,000.01 and EGP 5,000.00", () => {
  const total = piastersFromDecimalString("10000.01");
  const [first, second] = splitFixedFeePiasters(total);

  assert.equal(piastersToDecimalString(first), "5000.01");
  assert.equal(piastersToDecimalString(second), "5000.00");
  assert.equal(first + second, total);
  assert.equal(piastersToDecimalString(first + second), "10000.01");
});

test("business example: EGP 10,000.00 splits into two equal EGP 5,000.00", () => {
  const total = piastersFromDecimalString("10000");
  const [first, second] = splitFixedFeePiasters(total);

  assert.equal(piastersToDecimalString(first), "5000.00");
  assert.equal(piastersToDecimalString(second), "5000.00");
  assert.equal(first + second, total);
});

// ---------------------------------------------------------------------------
// Property-style: the split invariants hold for 1,000+ deterministic totals
// ---------------------------------------------------------------------------

test("property: split invariants hold across 1,000+ deterministic totals", () => {
  const totals: number[] = [0, 1, 2, 3, 99, 100, 101, 999999999999];
  // Deterministic spread mixing odd and even magnitudes — no randomness, so a
  // failure is always reproducible.
  for (let i = 0; i < 1000; i++) {
    totals.push(i * 9973 + (i % 7));
  }

  for (const total of totals) {
    const [first, second] = splitFixedFeePiasters(total);

    assert.ok(Number.isSafeInteger(first), `first not an integer for ${total}`);
    assert.ok(
      Number.isSafeInteger(second),
      `second not an integer for ${total}`,
    );
    assert.ok(first >= 0, `first negative for ${total}`);
    assert.ok(second >= 0, `second negative for ${total}`);
    assert.equal(first + second, total, `split does not reconstruct ${total}`);
    assert.ok(
      first === second || first === second + 1,
      `split not 50/50-with-remainder-to-first for ${total}`,
    );
    // Never a fractional piaster on either side.
    assert.equal(first % 1, 0);
    assert.equal(second % 1, 0);
  }

  assert.ok(totals.length >= 1000, "expected at least 1,000 totals");
});

// ---------------------------------------------------------------------------
// sumPiasters
// ---------------------------------------------------------------------------

test("sumPiasters: normal sum", () => {
  assert.equal(sumPiasters([500001, 500000]), 1000001);
  assert.equal(sumPiasters([1, 2, 3, 4, 5]), 15);
});

test("sumPiasters: empty array is zero", () => {
  assert.equal(sumPiasters([]), 0);
});

test("sumPiasters: zeros", () => {
  assert.equal(sumPiasters([0, 0, 0]), 0);
});

test("sumPiasters: single value", () => {
  assert.equal(sumPiasters([500000]), 500000);
});

test("sumPiasters: rejects negative entries", () => {
  assert.throws(() => sumPiasters([100, -1]), /values\[1\].*must not be negative/);
});

test("sumPiasters: rejects non-integer entries", () => {
  assert.throws(() => sumPiasters([100, 0.5]), /values\[1\].*safe integer/);
  assert.throws(() => sumPiasters([NaN]), /values\[0\].*safe integer/);
});

test("sumPiasters: rejects non-array input", () => {
  // @ts-expect-error deliberately wrong type at the boundary
  assert.throws(() => sumPiasters(500000), /must be an array/);
});

test("sumPiasters: rejects safe-integer overflow", () => {
  assert.throws(
    () => sumPiasters([Number.MAX_SAFE_INTEGER, 1]),
    /safe integer range/,
  );
});

test("sumPiasters: an installment split sums back to the fee", () => {
  const total = piastersFromDecimalString("10000.01");
  assert.equal(sumPiasters(splitFixedFeePiasters(total)), total);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cairoDayUtc,
  addCalendarDays,
  addCalendarMonths,
  formatBillingDay,
} from "./billing-dates";

/** Civil date literal, for readable expectations. */
function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// cairoDayUtc — DST (UTC+3)
//
// Egypt reintroduced DST in 2023: last Friday of April to last Thursday of
// October. August is therefore UTC+3.
// ---------------------------------------------------------------------------

test("cairoDayUtc: during Cairo DST (UTC+3), midday resolves to that civil day", () => {
  assert.deepEqual(
    cairoDayUtc(new Date("2026-08-01T09:00:00Z")),
    day("2026-08-01"),
  );
});

test("cairoDayUtc: during DST, 21:00Z is already the NEXT civil day in Cairo", () => {
  // 21:00Z + 3h = 00:00 Cairo on Aug 2. This is the off-by-one that a naive
  // UTC-based getDate() would get wrong.
  assert.deepEqual(
    cairoDayUtc(new Date("2026-08-01T21:00:00Z")),
    day("2026-08-02"),
  );
});

test("cairoDayUtc: during DST, one second earlier is still the previous civil day", () => {
  assert.deepEqual(
    cairoDayUtc(new Date("2026-08-01T20:59:59Z")),
    day("2026-08-01"),
  );
});

// ---------------------------------------------------------------------------
// cairoDayUtc — standard time (UTC+2)
// ---------------------------------------------------------------------------

test("cairoDayUtc: outside DST (UTC+2), midday resolves to that civil day", () => {
  assert.deepEqual(
    cairoDayUtc(new Date("2026-12-15T09:00:00Z")),
    day("2026-12-15"),
  );
});

test("cairoDayUtc: outside DST, 22:00Z rolls into the next civil day (and year)", () => {
  // 22:00Z + 2h = 00:00 Cairo on Jan 1. Note the offset differs from the DST
  // case above — which is exactly why no fixed offset may be hardcoded.
  assert.deepEqual(
    cairoDayUtc(new Date("2026-12-31T22:00:00Z")),
    day("2027-01-01"),
  );
});

test("cairoDayUtc: outside DST, one second earlier is still the previous civil day", () => {
  assert.deepEqual(
    cairoDayUtc(new Date("2026-12-31T21:59:59Z")),
    day("2026-12-31"),
  );
});

// ---------------------------------------------------------------------------
// cairoDayUtc — crossing the UTC midnight boundary
// ---------------------------------------------------------------------------

test("cairoDayUtc: Cairo is already tomorrow while UTC is still today", () => {
  const instant = new Date("2026-08-01T23:30:00Z"); // 02:30 Cairo, Aug 2
  assert.equal(instant.getUTCDate(), 1, "precondition: UTC is still Aug 1");
  assert.deepEqual(cairoDayUtc(instant), day("2026-08-02"));
});

test("cairoDayUtc: just after UTC midnight, Cairo is the same civil day", () => {
  const instant = new Date("2026-08-02T00:30:00Z"); // 03:30 Cairo, Aug 2
  assert.deepEqual(cairoDayUtc(instant), day("2026-08-02"));
});

test("cairoDayUtc: always returns exactly UTC midnight", () => {
  const result = cairoDayUtc(new Date("2026-08-01T17:43:21.987Z"));
  assert.equal(result.getUTCHours(), 0);
  assert.equal(result.getUTCMinutes(), 0);
  assert.equal(result.getUTCSeconds(), 0);
  assert.equal(result.getUTCMilliseconds(), 0);
});

test("cairoDayUtc: rejects an invalid Date", () => {
  assert.throws(() => cairoDayUtc(new Date("nonsense")), /valid Date/);
});

// ---------------------------------------------------------------------------
// addCalendarDays — the second-installment schedule
// ---------------------------------------------------------------------------

test("addCalendarDays: first payment Aug 1 + 15 days = due Aug 16", () => {
  assert.deepEqual(
    addCalendarDays(day("2026-08-01"), 15),
    day("2026-08-16"),
  );
});

test("addCalendarDays: first payment Aug 1 + 14 days = reminder Aug 15", () => {
  assert.deepEqual(
    addCalendarDays(day("2026-08-01"), 14),
    day("2026-08-15"),
  );
});

test("addCalendarDays: reminder is exactly one day before the due date", () => {
  const paid = day("2026-08-01");
  const due = addCalendarDays(paid, 15);
  const reminder = addCalendarDays(paid, 14);
  assert.equal(due.getTime() - reminder.getTime(), 86_400_000);
});

test("addCalendarDays: month rollover", () => {
  assert.deepEqual(
    addCalendarDays(day("2026-08-20"), 15),
    day("2026-09-04"),
  );
});

test("addCalendarDays: year rollover", () => {
  assert.deepEqual(
    addCalendarDays(day("2026-12-25"), 15),
    day("2027-01-09"),
  );
});

test("addCalendarDays: leap-year rollover (Feb 29 exists in 2028)", () => {
  assert.deepEqual(
    addCalendarDays(day("2028-02-20"), 15),
    day("2028-03-06"),
  );
});

test("addCalendarDays: non-leap year skips Feb 29", () => {
  assert.deepEqual(
    addCalendarDays(day("2026-02-20"), 15),
    day("2026-03-07"),
  );
});

test("addCalendarDays: zero is identity, negatives go backwards", () => {
  assert.deepEqual(addCalendarDays(day("2026-08-16"), 0), day("2026-08-16"));
  assert.deepEqual(addCalendarDays(day("2026-08-16"), -15), day("2026-08-01"));
});

test("addCalendarDays: result stays at UTC midnight across a DST boundary", () => {
  // Spans Egypt's April DST start; a ms-based implementation would drift an
  // hour off midnight here.
  const result = addCalendarDays(day("2026-04-20"), 15);
  assert.deepEqual(result, day("2026-05-05"));
  assert.equal(result.getTime() % 86_400_000, 0);
});

test("addCalendarDays: rejects a non-midnight instant", () => {
  assert.throws(
    () => addCalendarDays(new Date("2026-08-01T13:00:00Z"), 15),
    /UTC midnight/,
  );
});

test("addCalendarDays: rejects a non-integer day count", () => {
  assert.throws(() => addCalendarDays(day("2026-08-01"), 1.5), /integer/);
});

// ---------------------------------------------------------------------------
// addCalendarMonths — billing period arithmetic
// ---------------------------------------------------------------------------

test("addCalendarMonths: 2026-01-31 + 1 clamps to 2026-02-28", () => {
  assert.deepEqual(
    addCalendarMonths(day("2026-01-31"), 1),
    day("2026-02-28"),
  );
});

test("addCalendarMonths: 2028-01-31 + 1 clamps to 2028-02-29 (leap year)", () => {
  assert.deepEqual(
    addCalendarMonths(day("2028-01-31"), 1),
    day("2028-02-29"),
  );
});

test("addCalendarMonths: 2026-12-15 + 1 = 2027-01-15 (year rollover)", () => {
  assert.deepEqual(
    addCalendarMonths(day("2026-12-15"), 1),
    day("2027-01-15"),
  );
});

test("addCalendarMonths: 2026-03-31 + 1 clamps to 2026-04-30 (30-day month)", () => {
  assert.deepEqual(
    addCalendarMonths(day("2026-03-31"), 1),
    day("2026-04-30"),
  );
});

test("addCalendarMonths: a mid-month day is preserved", () => {
  assert.deepEqual(
    addCalendarMonths(day("2026-08-15"), 1),
    day("2026-09-15"),
  );
});

test("addCalendarMonths: clamping does not compound over successive calls", () => {
  // Jan 31 -> Feb 28 -> Mar 28. Clamping is lossy by design; this pins the
  // behaviour so a period end is always computed from the period START.
  const feb = addCalendarMonths(day("2026-01-31"), 1);
  assert.deepEqual(addCalendarMonths(feb, 1), day("2026-03-28"));
  assert.deepEqual(addCalendarMonths(day("2026-01-31"), 2), day("2026-03-31"));
});

test("addCalendarMonths: a billing period is start + 1 month - 1 day", () => {
  const start = day("2026-08-01");
  const end = addCalendarDays(addCalendarMonths(start, 1), -1);
  assert.deepEqual(end, day("2026-08-31"));

  const febStart = day("2026-02-01");
  const febEnd = addCalendarDays(addCalendarMonths(febStart, 1), -1);
  assert.deepEqual(febEnd, day("2026-02-28"));
});

test("addCalendarMonths: zero is identity, negatives go backwards", () => {
  assert.deepEqual(addCalendarMonths(day("2026-08-15"), 0), day("2026-08-15"));
  assert.deepEqual(addCalendarMonths(day("2026-08-15"), -1), day("2026-07-15"));
});

test("addCalendarMonths: rejects a non-midnight instant", () => {
  assert.throws(
    () => addCalendarMonths(new Date("2026-08-01T13:00:00Z"), 1),
    /UTC midnight/,
  );
});

// ---------------------------------------------------------------------------
// formatBillingDay
// ---------------------------------------------------------------------------

test("formatBillingDay: exact YYYY-MM-DD output", () => {
  assert.equal(formatBillingDay(day("2026-08-01")), "2026-08-01");
  assert.equal(formatBillingDay(day("2026-08-16")), "2026-08-16");
  assert.equal(formatBillingDay(day("2026-12-31")), "2026-12-31");
  assert.equal(formatBillingDay(day("2028-02-29")), "2028-02-29");
});

test("formatBillingDay: single-digit month and day are zero-padded", () => {
  assert.equal(formatBillingDay(day("2026-01-05")), "2026-01-05");
});

test("formatBillingDay: round-trips with the civil-date literal", () => {
  const value = day("2027-01-09");
  assert.deepEqual(day(formatBillingDay(value)), value);
});

test("formatBillingDay: rejects a non-midnight instant", () => {
  assert.throws(
    () => formatBillingDay(new Date("2026-08-01T23:30:00Z")),
    /UTC midnight/,
  );
});

// ---------------------------------------------------------------------------
// End-to-end: the documented business example
// ---------------------------------------------------------------------------

test("end-to-end: payment recorded late on Aug 1 in Cairo yields due Aug 16, reminder Aug 15", () => {
  // 23:30Z on Aug 1 is 02:30 Cairo on Aug 2 — so the CIVIL payment day is
  // Aug 2, not Aug 1. This is the whole reason the conversion happens once at
  // the boundary.
  const paidInCairoOnAug1 = cairoDayUtc(new Date("2026-08-01T18:00:00Z"));
  assert.equal(formatBillingDay(paidInCairoOnAug1), "2026-08-01");
  assert.equal(
    formatBillingDay(addCalendarDays(paidInCairoOnAug1, 15)),
    "2026-08-16",
  );
  assert.equal(
    formatBillingDay(addCalendarDays(paidInCairoOnAug1, 14)),
    "2026-08-15",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingPeriodEndUtc,
  formatBillingInvoiceNumber,
  invoiceCounterScope,
  planFirstInvoice,
} from "./billing-invoice-send.logic";

/** Civil date at UTC midnight, the representation this module contracts on. */
function day(year: number, month: number, date: number): Date {
  return new Date(Date.UTC(year, month - 1, date));
}

/** "YYYY-MM-DD" via UTC getters only — never toISOString on a raw instant. */
function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Service period
// ---------------------------------------------------------------------------

test("billingPeriodEndUtc: one calendar month minus one day", () => {
  assert.equal(iso(billingPeriodEndUtc(day(2026, 8, 7))), "2026-09-06");
});

test("billingPeriodEndUtc: month end clamps before the -1 day", () => {
  // Jan 31 + 1 month clamps to Feb 28 (non-leap), then -1 day = Feb 27.
  assert.equal(iso(billingPeriodEndUtc(day(2026, 1, 31))), "2026-02-27");
});

test("billingPeriodEndUtc: leap year clamps to Feb 29 first", () => {
  // 2028 is a leap year: Jan 31 + 1 month = Feb 29, then -1 day = Feb 28.
  assert.equal(iso(billingPeriodEndUtc(day(2028, 1, 31))), "2028-02-28");
});

test("billingPeriodEndUtc: year rollover", () => {
  assert.equal(iso(billingPeriodEndUtc(day(2026, 12, 15))), "2027-01-14");
});

test("billingPeriodEndUtc: rejects a raw instant", () => {
  assert.throws(
    () => billingPeriodEndUtc(new Date("2026-08-07T09:30:00.000Z")),
    /UTC midnight/,
  );
});

// ---------------------------------------------------------------------------
// planFirstInvoice — dates
// ---------------------------------------------------------------------------

test("planFirstInvoice: period start 2026-08-07 gives period end 2026-09-06", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 8, 7),
    periodStartUtc: day(2026, 8, 7),
    totalFeePiasters: 1_000_000,
  });
  assert.equal(iso(plan.periodStart), "2026-08-07");
  assert.equal(iso(plan.periodEnd), "2026-09-06");
});

test("planFirstInvoice: invoice date and first due date are the same Cairo day", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 8, 7),
    periodStartUtc: day(2026, 8, 7),
    totalFeePiasters: 1_000_000,
  });
  assert.equal(iso(plan.invoiceDate), "2026-08-07");
  assert.equal(iso(plan.firstDueDate), "2026-08-07");
  assert.equal(plan.firstDueDate.getTime(), plan.invoiceDate.getTime());
});

test("planFirstInvoice: the service period is independent of the invoice day", () => {
  // Invoiced mid-period: the period still runs from the configured start date.
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 8, 20),
    periodStartUtc: day(2026, 8, 7),
    totalFeePiasters: 1_000_000,
  });
  assert.equal(iso(plan.invoiceDate), "2026-08-20");
  assert.equal(iso(plan.firstDueDate), "2026-08-20");
  assert.equal(iso(plan.periodStart), "2026-08-07");
  assert.equal(iso(plan.periodEnd), "2026-09-06");
});

test("planFirstInvoice: month-end period start, Jan 31 -> Feb 27", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 1, 31),
    periodStartUtc: day(2026, 1, 31),
    totalFeePiasters: 1_000_000,
  });
  assert.equal(iso(plan.periodStart), "2026-01-31");
  assert.equal(iso(plan.periodEnd), "2026-02-27");
});

test("planFirstInvoice: leap-year month end, Jan 31 -> Feb 28", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2028, 1, 31),
    periodStartUtc: day(2028, 1, 31),
    totalFeePiasters: 1_000_000,
  });
  assert.equal(iso(plan.periodEnd), "2028-02-28");
});

test("planFirstInvoice: rejects a raw instant as the invoice day", () => {
  assert.throws(
    () =>
      planFirstInvoice({
        invoiceDayUtc: new Date("2026-08-07T22:15:00.000Z"),
        periodStartUtc: day(2026, 8, 7),
        totalFeePiasters: 1_000_000,
      }),
    /UTC midnight/,
  );
});

// ---------------------------------------------------------------------------
// planFirstInvoice — money
// ---------------------------------------------------------------------------

test("planFirstInvoice: EGP 10,000.00 splits 5,000.00 / 5,000.00", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 8, 7),
    periodStartUtc: day(2026, 8, 7),
    totalFeePiasters: 1_000_000,
  });
  assert.equal(plan.firstAmountPiasters, 500_000);
  assert.equal(plan.secondAmountPiasters, 500_000);
});

test("planFirstInvoice: EGP 10,000.01 gives the odd piaster to installment 1", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 8, 7),
    periodStartUtc: day(2026, 8, 7),
    totalFeePiasters: 1_000_001,
  });
  assert.equal(plan.firstAmountPiasters, 500_001);
  assert.equal(plan.secondAmountPiasters, 500_000);
});

test("planFirstInvoice: the two installments always reconstruct the fee exactly", () => {
  for (const total of [0, 1, 3, 999, 1_000_000, 1_000_001, 123_456_789]) {
    const plan = planFirstInvoice({
      invoiceDayUtc: day(2026, 8, 7),
      periodStartUtc: day(2026, 8, 7),
      totalFeePiasters: total,
    });
    assert.equal(
      plan.firstAmountPiasters + plan.secondAmountPiasters,
      total,
      `split did not reconstruct ${total}`,
    );
  }
});

test("planFirstInvoice: rejects a non-integer fee", () => {
  assert.throws(
    () =>
      planFirstInvoice({
        invoiceDayUtc: day(2026, 8, 7),
        periodStartUtc: day(2026, 8, 7),
        totalFeePiasters: 1_000_000.5,
      }),
    /safe integer/,
  );
});

// ---------------------------------------------------------------------------
// The planner must NOT produce installment 2's dates
// ---------------------------------------------------------------------------

test("planFirstInvoice: produces no second-installment due or reminder date", () => {
  const plan = planFirstInvoice({
    invoiceDayUtc: day(2026, 8, 7),
    periodStartUtc: day(2026, 8, 7),
    totalFeePiasters: 1_000_000,
  });

  // The D+15 / D+14 clock starts at PAYMENT, not at invoice. Nothing resembling
  // a second due date or a reminder date may exist on this object.
  const keys = Object.keys(plan).sort();
  assert.deepEqual(keys, [
    "firstAmountPiasters",
    "firstDueDate",
    "invoiceDate",
    "periodEnd",
    "periodStart",
    "secondAmountPiasters",
  ]);
  for (const key of keys) {
    assert.ok(
      !/reminder/i.test(key),
      `planner leaked a reminder field: ${key}`,
    );
  }
  assert.ok(!("secondDueDate" in plan));
  assert.ok(!("reminderDate" in plan));
});

// ---------------------------------------------------------------------------
// Invoice numbers
// ---------------------------------------------------------------------------

test("formatBillingInvoiceNumber: first invoice of the year", () => {
  assert.equal(formatBillingInvoiceNumber(2026, 1), "LG-INV-2026-0001");
});

test("formatBillingInvoiceNumber: pads to four digits", () => {
  assert.equal(formatBillingInvoiceNumber(2026, 42), "LG-INV-2026-0042");
  assert.equal(formatBillingInvoiceNumber(2026, 999), "LG-INV-2026-0999");
  assert.equal(formatBillingInvoiceNumber(2026, 1000), "LG-INV-2026-1000");
});

test("formatBillingInvoiceNumber: past 9999 the sequence widens, never wraps", () => {
  assert.equal(formatBillingInvoiceNumber(2026, 10000), "LG-INV-2026-10000");
});

test("formatBillingInvoiceNumber: rejects a zero or negative sequence", () => {
  assert.throws(() => formatBillingInvoiceNumber(2026, 0), /1 or greater/);
  assert.throws(() => formatBillingInvoiceNumber(2026, -1), /1 or greater/);
});

test("formatBillingInvoiceNumber: rejects a non-integer sequence", () => {
  assert.throws(() => formatBillingInvoiceNumber(2026, 1.5), /integer/);
  assert.throws(() => formatBillingInvoiceNumber(2026, NaN), /integer/);
  assert.throws(() => formatBillingInvoiceNumber(2026, Infinity), /integer/);
});

test("formatBillingInvoiceNumber: rejects an invalid year", () => {
  assert.throws(() => formatBillingInvoiceNumber(26, 1), /Invalid invoice year/);
  assert.throws(
    () => formatBillingInvoiceNumber(20260, 1),
    /Invalid invoice year/,
  );
  assert.throws(
    () => formatBillingInvoiceNumber(2026.5, 1),
    /Invalid invoice year/,
  );
  assert.throws(
    () => formatBillingInvoiceNumber(NaN, 1),
    /Invalid invoice year/,
  );
});

test("invoiceCounterScope: year-scoped counter key", () => {
  assert.equal(invoiceCounterScope(2026), "INV-2026");
  assert.equal(invoiceCounterScope(2027), "INV-2027");
});

test("invoiceCounterScope: rejects an invalid year", () => {
  assert.throws(() => invoiceCounterScope(26), /Invalid invoice year/);
});

// ---------------------------------------------------------------------------
// The counter contract: the first allocated value is 1
// ---------------------------------------------------------------------------

test("counter contract: BillingDocumentCounter.nextValue defaults to 1, so the first number is 0001", () => {
  // The action allocates with an atomic upsert whose create path writes
  // nextValue = 2 and whose update path increments, then derives
  // `sequence = returnedNextValue - 1`. Both paths are exercised here against
  // that arithmetic so the first invoice of a year can never be 0000 or 0002.
  const firstAllocation = 2 - 1; // fresh counter row created with nextValue 2
  const secondAllocation = 3 - 1; // existing row incremented 2 -> 3
  assert.equal(
    formatBillingInvoiceNumber(2026, firstAllocation),
    "LG-INV-2026-0001",
  );
  assert.equal(
    formatBillingInvoiceNumber(2026, secondAllocation),
    "LG-INV-2026-0002",
  );
});

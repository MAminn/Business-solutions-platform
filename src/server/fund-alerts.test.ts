import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFundThresholds } from "./fund-alerts";

test("0% spent: no thresholds crossed", () => {
  const r = evaluateFundThresholds({ fundAmount: 1000, spendToDate: 0 });
  assert.equal(r.percentSpent, 0);
  assert.deepEqual(r.crossedThresholds, []);
  assert.equal(r.highestCrossed, null);
});

test("exactly 50%: crosses 50 only", () => {
  const r = evaluateFundThresholds({ fundAmount: 1000, spendToDate: 500 });
  assert.equal(r.percentSpent, 50);
  assert.deepEqual(r.crossedThresholds, [50]);
  assert.equal(r.highestCrossed, 50);
});

test("76%: crosses 50 and 75, not 90", () => {
  const r = evaluateFundThresholds({ fundAmount: 1000, spendToDate: 760 });
  assert.equal(r.percentSpent, 76);
  assert.deepEqual(r.crossedThresholds, [50, 75]);
  assert.equal(r.highestCrossed, 75);
});

test("100%: all thresholds crossed", () => {
  const r = evaluateFundThresholds({ fundAmount: 1000, spendToDate: 1000 });
  assert.equal(r.percentSpent, 100);
  assert.deepEqual(r.crossedThresholds, [50, 75, 90, 100]);
  assert.equal(r.highestCrossed, 100);
});

test(">100%: all thresholds crossed", () => {
  const r = evaluateFundThresholds({ fundAmount: 1000, spendToDate: 1500 });
  assert.equal(r.percentSpent, 150);
  assert.deepEqual(r.crossedThresholds, [50, 75, 90, 100]);
  assert.equal(r.highestCrossed, 100);
});

test("fundAmount = 0: no divide-by-zero, empty crossed", () => {
  const r = evaluateFundThresholds({ fundAmount: 0, spendToDate: 500 });
  assert.equal(r.percentSpent, 0);
  assert.deepEqual(r.crossedThresholds, []);
  assert.equal(r.highestCrossed, null);
});

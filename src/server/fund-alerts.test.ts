import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFundThresholds,
  buildFundAlertEmail,
  subtractAlreadySent,
} from "./fund-alerts";

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

// --- subtractAlreadySent (newlyCrossed = crossed MINUS alreadySent) ---------

test("subtractAlreadySent: removes already-sent and sorts ascending", () => {
  assert.deepEqual(subtractAlreadySent([50, 75, 90], [50]), [75, 90]);
});

test("subtractAlreadySent: all already sent -> empty", () => {
  assert.deepEqual(subtractAlreadySent([50, 75], [75, 50]), []);
});

test("subtractAlreadySent: nothing sent -> unchanged (sorted)", () => {
  assert.deepEqual(subtractAlreadySent([90, 50, 75], []), [50, 75, 90]);
});

// --- buildFundAlertEmail (pure) ---------------------------------------------

test("buildFundAlertEmail: subject names account and highest newly-crossed", () => {
  const { subject } = buildFundAlertEmail({
    accountName: "Mach Supplements",
    currency: "USD",
    fundAmount: 1000,
    spendToDate: 920,
    percentSpent: 92,
    newlyCrossed: [75, 90],
  });
  assert.equal(subject, "Mach Supplements — 90% of fund spent (Meta-reported)");
});

test("buildFundAlertEmail: body is labelled Meta-reported, not real sales", () => {
  const { html } = buildFundAlertEmail({
    accountName: "Mach Supplements",
    currency: "USD",
    fundAmount: 1000,
    spendToDate: 500,
    percentSpent: 50,
    newlyCrossed: [50],
  });
  assert.ok(html.includes("Meta-reported"));
  assert.ok(html.includes("NOT reconciled against real sales"));
  assert.ok(html.includes("Mach Supplements"));
});

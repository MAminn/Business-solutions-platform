import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createClientSchema,
  updateClientSchema,
  resolveBillingProfile,
  civilDateToUtcDate,
} from "./clients.schemas";

// ============================================================================
// Loopa commercial / billing profile validation (fixed fee, EGP, 50/50).
//
// These cases pin the rules that keep Loopa's SERVICE FEE separate from the
// client's ADVERTISING budget (`monthlyBudget`), and keep the fee exact:
// validated as a decimal string and carried through integer piasters, never a
// JS float.
// ============================================================================

/** Minimum valid non-billing payload for the create form. */
function baseCreate(): Record<string, unknown> {
  return { name: "Acme" };
}

/** A complete, valid billing payload. */
function validBilling(): Record<string, unknown> {
  return {
    billingEnabled: "on",
    serviceFeeAmount: "10000",
    serviceFeeCurrency: "EGP",
    billingContactEmail: "billing@client.com",
    billingCycleStartDate: "2026-08-01",
  };
}

function parseCreate(overrides: Record<string, unknown>) {
  return createClientSchema.safeParse({ ...baseCreate(), ...overrides });
}

/** Assert the parse failed AND the error landed on the expected field. */
function assertRejectedOn(
  result: ReturnType<typeof parseCreate>,
  field: string,
): void {
  assert.equal(result.success, false, "expected the payload to be rejected");
  if (result.success) return;
  const keys = Object.keys(result.error.flatten().fieldErrors);
  assert.ok(
    keys.includes(field),
    `expected an error on [${field}], got [${keys.join(", ")}]`,
  );
}

// ---------------------------------------------------------------------------
// PASS cases
// ---------------------------------------------------------------------------

test("billing disabled with every billing field empty is valid", () => {
  // Every billing input is disabled in the form while billing is off, so the
  // browser omits them and FormData.get() yields null for each.
  const result = parseCreate({
    billingEnabled: null,
    serviceFeeAmount: null,
    serviceFeeCurrency: null,
    billingContactName: null,
    billingContactEmail: null,
    billingCycleStartDate: null,
  });
  assert.equal(result.success, true);
});

test("billing enabled with 10000 / EGP / valid email / valid date is valid", () => {
  assert.equal(parseCreate(validBilling()).success, true);
});

test("billing enabled with 10000.01 is valid", () => {
  const result = parseCreate({
    ...validBilling(),
    serviceFeeAmount: "10000.01",
  });
  assert.equal(result.success, true);
});

test("optional billingContactName may be populated", () => {
  const result = parseCreate({
    ...validBilling(),
    billingContactName: "Nour Hassan",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.billingContactName, "Nour Hassan");
  }
});

test("surrounding whitespace on the fee is trimmed, not rejected", () => {
  const result = parseCreate({
    ...validBilling(),
    serviceFeeAmount: "  10000.01  ",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(
      resolveBillingProfile(result.data).serviceFeeAmount,
      "10000.01",
    );
  }
});

// ---------------------------------------------------------------------------
// FAIL cases
// ---------------------------------------------------------------------------

test("rejects a missing fee when billing is enabled", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeAmount: null }),
    "serviceFeeAmount",
  );
});

test("rejects 10000.001 — more than two decimal places", () => {
  // Decimal(12, 2) would silently round this on write.
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeAmount: "10000.001" }),
    "serviceFeeAmount",
  );
});

test("rejects a negative fee", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeAmount: "-5" }),
    "serviceFeeAmount",
  );
});

test("rejects a zero fee", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeAmount: "0" }),
    "serviceFeeAmount",
  );
});

test("rejects scientific notation", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeAmount: "1e4" }),
    "serviceFeeAmount",
  );
});

test("rejects other malformed fee values", () => {
  for (const bad of ["abc", "10,000.00", "10000.", ".5", "+5", "1 000"]) {
    assertRejectedOn(
      parseCreate({ ...validBilling(), serviceFeeAmount: bad }),
      "serviceFeeAmount",
    );
  }
});

test("rejects a currency other than EGP", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeCurrency: "USD" }),
    "serviceFeeCurrency",
  );
});

test("rejects a missing currency when billing is enabled", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), serviceFeeCurrency: null }),
    "serviceFeeCurrency",
  );
});

test("rejects a malformed billing contact email", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), billingContactEmail: "not-an-email" }),
    "billingContactEmail",
  );
});

test("rejects a missing billing contact email when billing is enabled", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), billingContactEmail: null }),
    "billingContactEmail",
  );
});

test("rejects a start date that is not strict YYYY-MM-DD", () => {
  for (const bad of ["01/08/2026", "2026-8-1", "Aug 1 2026", "20260801"]) {
    assertRejectedOn(
      parseCreate({ ...validBilling(), billingCycleStartDate: bad }),
      "billingCycleStartDate",
    );
  }
});

test("rejects an impossible calendar date such as 2026-02-30", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2027-02-29"]) {
    assertRejectedOn(
      parseCreate({ ...validBilling(), billingCycleStartDate: bad }),
      "billingCycleStartDate",
    );
  }
});

test("accepts a real leap day", () => {
  const result = parseCreate({
    ...validBilling(),
    billingCycleStartDate: "2028-02-29",
  });
  assert.equal(result.success, true);
});

test("rejects a missing start date when billing is enabled", () => {
  assertRejectedOn(
    parseCreate({ ...validBilling(), billingCycleStartDate: null }),
    "billingCycleStartDate",
  );
});

// ---------------------------------------------------------------------------
// Persistence shape — exact money, UTC-midnight date, cleared profile
// ---------------------------------------------------------------------------

test("enabled profile persists an exact canonical decimal string", () => {
  const cases: Array<[string, string]> = [
    ["10000", "10000.00"],
    ["10000.01", "10000.01"],
    ["10000.1", "10000.10"],
    ["0.05", "0.05"],
  ];
  for (const [input, expected] of cases) {
    const result = parseCreate({
      ...validBilling(),
      serviceFeeAmount: input,
    });
    assert.equal(result.success, true, `expected ${input} to be valid`);
    if (!result.success) continue;
    const profile = resolveBillingProfile(result.data);
    assert.equal(profile.serviceFeeAmount, expected);
    // A string, never a number — no float ever reaches Prisma.
    assert.equal(typeof profile.serviceFeeAmount, "string");
  }
});

test("enabled profile persists the start date at UTC midnight", () => {
  const result = parseCreate(validBilling());
  assert.equal(result.success, true);
  if (!result.success) return;
  const profile = resolveBillingProfile(result.data);
  assert.ok(profile.billingCycleStartDate instanceof Date);
  assert.equal(
    profile.billingCycleStartDate?.toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
  assert.equal(profile.serviceFeeCurrency, "EGP");
});

test("disabled billing clears all five profile fields", () => {
  const result = parseCreate({ billingEnabled: null });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(resolveBillingProfile(result.data), {
    billingEnabled: false,
    serviceFeeAmount: null,
    serviceFeeCurrency: null,
    billingContactName: null,
    billingContactEmail: null,
    billingCycleStartDate: null,
  });
});

test("civilDateToUtcDate never applies a local-timezone shift", () => {
  const d = civilDateToUtcDate("2026-08-01");
  assert.equal(d.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(d.getTime() % 86_400_000, 0);
});

// ---------------------------------------------------------------------------
// updateClientSchema — tri-state billingEnabled
// ---------------------------------------------------------------------------

function baseUpdate(): Record<string, unknown> {
  return {
    id: "client_1",
    name: "Acme",
    status: "ACTIVE",
    health: "GOOD",
  };
}

test("update: omitting billingEnabled does not require any billing field", () => {
  const result = updateClientSchema.safeParse(baseUpdate());
  assert.equal(result.success, true);
  if (!result.success) return;
  // undefined is the signal for "leave every billing column untouched".
  assert.equal(result.data.billingEnabled, undefined);
});

test("update: billingEnabled=false is accepted and clears the profile", () => {
  const result = updateClientSchema.safeParse({
    ...baseUpdate(),
    billingEnabled: false,
  });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.billingEnabled, false);
  assert.deepEqual(resolveBillingProfile(result.data), {
    billingEnabled: false,
    serviceFeeAmount: null,
    serviceFeeCurrency: null,
    billingContactName: null,
    billingContactEmail: null,
    billingCycleStartDate: null,
  });
});

test("update: billingEnabled=true requires the full configuration", () => {
  const missing = updateClientSchema.safeParse({
    ...baseUpdate(),
    billingEnabled: true,
  });
  assert.equal(missing.success, false);
  if (!missing.success) {
    const keys = Object.keys(missing.error.flatten().fieldErrors);
    for (const required of [
      "serviceFeeAmount",
      "serviceFeeCurrency",
      "billingContactEmail",
      "billingCycleStartDate",
    ]) {
      assert.ok(
        keys.includes(required),
        `expected [${required}] to be required when billing is enabled`,
      );
    }
  }

  const complete = updateClientSchema.safeParse({
    ...baseUpdate(),
    ...validBilling(),
    billingEnabled: true,
  });
  assert.equal(complete.success, true);
});

test("update: the same fee rules apply as on create", () => {
  const result = updateClientSchema.safeParse({
    ...baseUpdate(),
    ...validBilling(),
    billingEnabled: true,
    serviceFeeAmount: "10000.001",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(
      Object.keys(result.error.flatten().fieldErrors).includes(
        "serviceFeeAmount",
      ),
    );
  }
});

// ---------------------------------------------------------------------------
// monthlyBudget is a different concept and must stay independent
// ---------------------------------------------------------------------------

test("monthlyBudget is untouched by the billing profile", () => {
  const result = parseCreate({ ...validBilling(), monthlyBudget: "50000" });
  assert.equal(result.success, true);
  if (!result.success) return;
  // The advertising budget stays a plain number; the service fee is a separate
  // exact-decimal string. Changing one must never affect the other.
  assert.equal(result.data.monthlyBudget, 50000);
  assert.equal(
    resolveBillingProfile(result.data).serviceFeeAmount,
    "10000.00",
  );
});

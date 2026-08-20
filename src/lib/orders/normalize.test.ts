import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, tokenizeCsv } from "./csv";
import {
  cleanMoney,
  deriveMatchKey,
  normalizeFulfillmentState,
  normalizePaymentMethod,
  normalizePaymentState,
  parseSourceTimestamp,
  splitTags,
} from "./normalize";
import { adaptShopifyCsv, detectTrackingColumns } from "./shopify-csv";
import { resolveEgyptRegion } from "@/lib/geo/egypt-regions";

// All fixtures below are SYNTHETIC. No value here comes from a real export.

// ---------------------------------------------------------------------------
// CSV tokenizer — the cases that break split(",")
// ---------------------------------------------------------------------------

test("tokenizeCsv: commas inside a quoted field stay in one cell", () => {
  const rows = tokenizeCsv('a,"one, two, three",b');
  assert.deepEqual(rows, [["a", "one, two, three", "b"]]);
});

test('tokenizeCsv: "" inside a quoted field is one literal quote', () => {
  // The real export writes: "Normal Shipping ""2-5d"""
  const rows = tokenizeCsv('a,"Normal Shipping ""2-5d""",b');
  assert.deepEqual(rows, [["a", 'Normal Shipping "2-5d"', "b"]]);
});

test("tokenizeCsv: newlines inside quotes do not terminate the row", () => {
  const rows = tokenizeCsv('a,"line one\nline two",b');
  assert.deepEqual(rows, [["a", "line one\nline two", "b"]]);
});

test("tokenizeCsv: CRLF and LF both terminate rows", () => {
  assert.deepEqual(tokenizeCsv("a,b\r\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(tokenizeCsv("a,b\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("tokenizeCsv: a UTF-8 BOM is stripped from the first header", () => {
  const rows = tokenizeCsv("﻿Name,Id");
  assert.deepEqual(rows, [["Name", "Id"]]);
});

test("tokenizeCsv: empty trailing fields are preserved", () => {
  assert.deepEqual(tokenizeCsv("a,,c,"), [["a", "", "c", ""]]);
});

test("tokenizeCsv: a trailing newline does not create an empty record", () => {
  assert.deepEqual(tokenizeCsv("a,b\n"), [["a", "b"]]);
});

test("parseCsv: blank lines are skipped, not emitted as records", () => {
  const table = parseCsv("Name,Id\n#1,10\n\n#2,20\n");
  assert.equal(table.records.length, 2);
  assert.equal(table.rowCount, 2);
});

test("parseCsv: short rows are padded and reported as ragged", () => {
  const table = parseCsv("A,B,C\n1,2\n");
  assert.equal(table.records[0]["C"], "");
  assert.deepEqual(table.raggedRows, [2]);
});

test("parseCsv: Arabic cell values survive intact", () => {
  const table = parseCsv("City\nالعباسيه\n");
  assert.equal(table.records[0]["City"], "العباسيه");
});

// ---------------------------------------------------------------------------
// matchKey — the future Bosta join surface
// ---------------------------------------------------------------------------

test("deriveMatchKey: strips #, trims, lowercases, collapses whitespace", () => {
  assert.equal(deriveMatchKey("#5402"), "5402");
  assert.equal(deriveMatchKey("  #5402  "), "5402");
  assert.equal(deriveMatchKey("EG#5402"), "eg#5402");
  assert.equal(deriveMatchKey("MACH  5402"), "mach 5402");
  assert.equal(deriveMatchKey(""), "");
});

test("deriveMatchKey: order numbers differing only in case or spacing collide", () => {
  // Intended: a courier re-keying a reference by hand should still match.
  assert.equal(deriveMatchKey("#Mach 5402"), deriveMatchKey("#mach  5402"));
});

// ---------------------------------------------------------------------------
// Money and timestamps
// ---------------------------------------------------------------------------

test("cleanMoney: keeps the source's own decimal string verbatim", () => {
  assert.equal(cleanMoney("2569.00"), "2569.00");
  assert.equal(cleanMoney("0.00"), "0.00");
  assert.equal(cleanMoney(""), null);
  assert.equal(cleanMoney("1,234.00"), null);
  assert.equal(cleanMoney("EGP 10"), null);
});

test("parseSourceTimestamp: honours the source offset instead of assuming UTC", () => {
  // 18:26:35 +0300 is 15:26:35Z. Reading it as UTC would shift the order back
  // three hours and move late-evening orders to the previous day.
  const parsed = parseSourceTimestamp("2026-08-20 18:26:35 +0300");
  assert.equal(parsed?.toISOString(), "2026-08-20T15:26:35.000Z");
});

test("parseSourceTimestamp: a late-evening Cairo order keeps its own civil day", () => {
  const parsed = parseSourceTimestamp("2026-08-20 23:30:00 +0300");
  assert.equal(parsed?.toISOString(), "2026-08-20T20:30:00.000Z");
});

test("parseSourceTimestamp: blank and unparseable input return null", () => {
  assert.equal(parseSourceTimestamp(""), null);
  assert.equal(parseSourceTimestamp(null), null);
  assert.equal(parseSourceTimestamp("not a date"), null);
});

test("splitTags: splits on commas and preserves emoji and casing", () => {
  assert.deepEqual(
    splitTags("bosta_synced, Order Confirmation Sent, ✓ Fulfillment Notified"),
    ["bosta_synced", "Order Confirmation Sent", "✓ Fulfillment Notified"],
  );
  assert.deepEqual(splitTags(""), []);
});

// ---------------------------------------------------------------------------
// Payment method
// ---------------------------------------------------------------------------

test("normalizePaymentMethod: recognises the observed COD gateway label", () => {
  const result = normalizePaymentMethod("Cash on Delivery (COD)");
  assert.equal(result.method, "COD");
  assert.equal(result.isCod, true);
  assert.equal(result.unrecognized, false);
});

test("normalizePaymentMethod: COD spelling variants all resolve", () => {
  for (const value of ["cod", "COD", "cash_on_delivery", "Cash On Delivery"]) {
    assert.equal(normalizePaymentMethod(value).method, "COD", value);
  }
});

test("normalizePaymentMethod: the Arabic COD phrase resolves", () => {
  const arabicCod =
    "الدفع عند الاستلام";
  assert.equal(normalizePaymentMethod(arabicCod).method, "COD");
});

test("normalizePaymentMethod: 'cod' matches on a word boundary only", () => {
  // Guards against classifying an unrelated gateway as cash on delivery.
  assert.notEqual(normalizePaymentMethod("Codashop").method, "COD");
});

test("normalizePaymentMethod: a split payment containing COD is flagged COD", () => {
  const result = normalizePaymentMethod("Visa, Cash on Delivery (COD)");
  assert.equal(result.isCod, true);
  assert.equal(result.method, "COD");
  assert.equal(result.tokens.length, 2);
});

test("normalizePaymentMethod: a mixed prepaid split reports OTHER, not a winner", () => {
  const result = normalizePaymentMethod("Visa, Vodafone Cash");
  assert.equal(result.method, "OTHER");
  assert.equal(result.isCod, false);
});

test("normalizePaymentMethod: an unknown gateway surfaces rather than defaulting", () => {
  const result = normalizePaymentMethod("Some New Gateway");
  assert.equal(result.method, "UNKNOWN");
  assert.equal(result.unrecognized, true);
});

test("normalizePaymentMethod: a blank value is absent, not unrecognised", () => {
  const result = normalizePaymentMethod("");
  assert.equal(result.method, "UNKNOWN");
  assert.equal(result.unrecognized, false);
});

// ---------------------------------------------------------------------------
// Payment state
// ---------------------------------------------------------------------------

test("normalizePaymentState: COD pending is PENDING, the normal healthy state", () => {
  const result = normalizePaymentState({
    financialStatus: "pending",
    refundedAmount: "0.00",
    totalAmount: "2569.00",
  });
  assert.equal(result.state, "PENDING");
});

test("normalizePaymentState: refunded amount outranks the status label", () => {
  // Status still says paid, but money went back. The number wins.
  const partial = normalizePaymentState({
    financialStatus: "paid",
    refundedAmount: "100.00",
    totalAmount: "2569.00",
  });
  assert.equal(partial.state, "PARTIALLY_REFUNDED");

  const full = normalizePaymentState({
    financialStatus: "paid",
    refundedAmount: "2569.00",
    totalAmount: "2569.00",
  });
  assert.equal(full.state, "REFUNDED");
});

test("normalizePaymentState: an unknown financial status surfaces", () => {
  const result = normalizePaymentState({
    financialStatus: "some_new_status",
    refundedAmount: "0.00",
    totalAmount: "10.00",
  });
  assert.equal(result.state, "UNKNOWN");
  assert.equal(result.unrecognized, true);
});

// ---------------------------------------------------------------------------
// Fulfillment state
// ---------------------------------------------------------------------------

test("normalizeFulfillmentState: cancellation outranks a 'fulfilled' status", () => {
  const result = normalizeFulfillmentState({
    fulfillmentStatus: "fulfilled",
    cancelledAt: new Date("2026-08-21T10:00:00Z"),
    fulfilledAt: new Date("2026-08-20T15:26:35Z"),
  });
  assert.equal(result.state, "CANCELLED");
});

test("normalizeFulfillmentState: restocked maps to RETURNED", () => {
  const result = normalizeFulfillmentState({
    fulfillmentStatus: "restocked",
    cancelledAt: null,
    fulfilledAt: null,
  });
  assert.equal(result.state, "RETURNED");
});

test("normalizeFulfillmentState: a blank status with a timestamp trusts the event", () => {
  const result = normalizeFulfillmentState({
    fulfillmentStatus: null,
    cancelledAt: null,
    fulfilledAt: new Date("2026-08-20T15:26:35Z"),
  });
  assert.equal(result.state, "FULFILLED");
});

test("normalizeFulfillmentState: nothing at all is UNFULFILLED", () => {
  const result = normalizeFulfillmentState({
    fulfillmentStatus: null,
    cancelledAt: null,
    fulfilledAt: null,
  });
  assert.equal(result.state, "UNFULFILLED");
  assert.equal(result.unrecognized, false);
});

// ---------------------------------------------------------------------------
// Region resolution
// ---------------------------------------------------------------------------

test("resolveEgyptRegion: country + province code composes the canonical key", () => {
  const result = resolveEgyptRegion({
    countryCode: "EG",
    provinceCode: "C",
    provinceName: "Cairo",
    city: "Nasr City",
  });
  assert.equal(result.code, "EG-C");
  assert.equal(result.status, "MAPPED_FROM_CODE");
  assert.equal(result.name, "Cairo");
});

test("resolveEgyptRegion: falls back to the province name when the code is blank", () => {
  const result = resolveEgyptRegion({
    countryCode: "EG",
    provinceCode: null,
    provinceName: "Alexandria",
    city: null,
  });
  assert.equal(result.code, "EG-ALX");
  assert.equal(result.status, "MAPPED_FROM_NAME");
});

test("resolveEgyptRegion: a city alone is UNMAPPED, never guessed onto a governorate", () => {
  // District-level aliasing does not exist yet; inferring Cairo here would be
  // exactly the silent invention the decision record forbids.
  const result = resolveEgyptRegion({
    countryCode: "EG",
    provinceCode: null,
    provinceName: null,
    city: "العباسيه",
  });
  assert.equal(result.code, "UNMAPPED");
  assert.equal(result.status, "UNMAPPED");
});

test("resolveEgyptRegion: no location at all is MISSING, distinct from UNMAPPED", () => {
  const result = resolveEgyptRegion({
    countryCode: "EG",
    provinceCode: null,
    provinceName: null,
    city: null,
  });
  assert.equal(result.code, "MISSING");
  assert.equal(result.status, "MISSING");
});

test("resolveEgyptRegion: a non-Egypt order is OUT_OF_SCOPE, not UNMAPPED", () => {
  // Keeps rows no alias can fix out of the alias work queue.
  const result = resolveEgyptRegion({
    countryCode: "SA",
    provinceCode: "01",
    provinceName: "Riyadh",
    city: "Riyadh",
  });
  assert.equal(result.code, null);
  assert.equal(result.status, "OUT_OF_SCOPE");
});

test("resolveEgyptRegion: an unknown Egyptian province code is UNMAPPED", () => {
  const result = resolveEgyptRegion({
    countryCode: "EG",
    provinceCode: "ZZ",
    provinceName: null,
    city: null,
  });
  assert.equal(result.code, "UNMAPPED");
});

// ---------------------------------------------------------------------------
// Adapter — grouping, PII exclusion, tracking-column absence
// ---------------------------------------------------------------------------

const HEADER = [
  "Name",
  "Email",
  "Financial Status",
  "Fulfillment Status",
  "Currency",
  "Total",
  "Shipping Method",
  "Created at",
  "Lineitem quantity",
  "Shipping City",
  "Shipping Province",
  "Shipping Province Name",
  "Shipping Country",
  "Shipping Phone",
  "Cancelled at",
  "Payment Method",
  "Refunded Amount",
  "Id",
  "Tags",
  "Source",
].join(",");

test("adaptShopifyCsv: maps a single-line-item order", () => {
  const csv = [
    HEADER,
    '#5402,buyer@example.test,pending,fulfilled,EGP,2569.00,"Normal Shipping ""2-5d""",2026-08-20 18:26:28 +0300,1,Cairo,C,Cairo,EG,+201000000000,,Cash on Delivery (COD),0.00,7577148162270,"bosta_synced, ✓ Fulfillment Notified",web',
  ].join("\n");

  const result = adaptShopifyCsv(csv);
  assert.equal(result.orders.length, 1);

  const order = result.orders[0];
  assert.equal(order.externalId, "7577148162270");
  assert.equal(order.orderNumber, "#5402");
  assert.equal(order.matchKey, "5402");
  assert.equal(order.currency, "EGP");
  assert.equal(order.totalAmount, "2569.00");
  assert.equal(order.paymentMethod, "COD");
  assert.equal(order.paymentState, "PENDING");
  assert.equal(order.fulfillmentState, "FULFILLED");
  assert.equal(order.regionCode, "EG-C");
  assert.equal(order.rawShippingMethod, 'Normal Shipping "2-5d"');
  assert.equal(order.salesChannel, "web");
  assert.equal(order.itemCount, 1);
  assert.equal(order.sourceRowCount, 1);
  assert.deepEqual(order.tags, ["bosta_synced", "✓ Fulfillment Notified"]);
});

test("adaptShopifyCsv: no PII value appears anywhere in a normalized order", () => {
  const csv = [
    HEADER,
    '#5402,buyer@example.test,pending,fulfilled,EGP,2569.00,Normal,2026-08-20 18:26:28 +0300,1,Cairo,C,Cairo,EG,+201000000000,,Cash on Delivery (COD),0.00,7577148162270,tag,web',
  ].join("\n");

  const serialized = JSON.stringify(adaptShopifyCsv(csv).orders);
  assert.equal(serialized.includes("buyer@example.test"), false);
  assert.equal(serialized.includes("+201000000000"), false);
});

test("adaptShopifyCsv: a fanned-out order becomes ONE order, not three", () => {
  // The correctness case a single-line-item sample cannot show: summing Total
  // across raw rows would triple this order's revenue.
  const csv = [
    HEADER,
    "#5403,,pending,fulfilled,EGP,3000.00,Normal,2026-08-20 18:26:28 +0300,2,Giza,GZ,Giza,EG,,,Cash on Delivery (COD),0.00,7577148162271,tag,web",
    ",,,,,,,,3,,,,,,,,,,,",
    ",,,,,,,,1,,,,,,,,,,,",
  ].join("\n");

  const result = adaptShopifyCsv(csv);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].totalAmount, "3000.00");
  assert.equal(result.orders[0].itemCount, 6);
  assert.equal(result.orders[0].sourceRowCount, 3);
  assert.equal(result.orders[0].regionCode, "EG-GZ");
});

test("adaptShopifyCsv: a repeated Id on continuation rows also groups to one order", () => {
  // The other possible export shape. Both must yield one order.
  const csv = [
    HEADER,
    "#5404,,pending,fulfilled,EGP,500.00,Normal,2026-08-20 18:26:28 +0300,1,Cairo,C,Cairo,EG,,,Cash on Delivery (COD),0.00,7577148162272,tag,web",
    "#5404,,,,,,,,2,,,,,,,,,7577148162272,,",
  ].join("\n");

  const result = adaptShopifyCsv(csv);
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].itemCount, 3);
});

test("adaptShopifyCsv: blank and non-numeric line-item quantities contribute 0", () => {
  // Real exports sometimes blank `Lineitem quantity` on a continuation row.
  // Rows 2 and 3 must contribute nothing to itemCount without disturbing the
  // grouping, the order total, or the row count.
  const csv = [
    HEADER,
    "#5406,,pending,fulfilled,EGP,1500.00,Normal,2026-08-20 18:26:28 +0300,2,Cairo,C,Cairo,EG,,,Cash on Delivery (COD),0.00,7577148162274,tag,web",
    ",,,,,,,,,,,,,,,,,,,",
    ",,,,,,,,abc,,,,,,,,,,,",
    ",,,,,,,,1,,,,,,,,,,,",
  ].join("\n");

  const result = adaptShopifyCsv(csv);
  assert.equal(result.orders.length, 1);

  const order = result.orders[0];
  // 2 + (blank -> 0) + (non-numeric -> 0) + 1
  assert.equal(order.itemCount, 3);
  // Order-level fields come from the first row, never summed across the group.
  assert.equal(order.totalAmount, "1500.00");
  assert.equal(order.currency, "EGP");
  // Every physical row is still accounted for, including the ones that
  // contributed no quantity.
  assert.equal(order.sourceRowCount, 4);
});

test("adaptShopifyCsv: an order with no parseable Total is skipped with an error", () => {
  const csv = [
    HEADER,
    "#5405,,pending,,EGP,,Normal,2026-08-20 18:26:28 +0300,1,Cairo,C,Cairo,EG,,,Cash on Delivery (COD),0.00,7577148162273,,web",
  ].join("\n");

  const result = adaptShopifyCsv(csv);
  assert.equal(result.orders.length, 0);
  assert.ok(
    result.issues.some((issue) => issue.code === "missing_or_invalid_total"),
  );
});

test("adaptShopifyCsv: a missing required column is reported", () => {
  const result = adaptShopifyCsv("Name,Total\n#1,10.00\n");
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "missing_required_column" && issue.value === "Id",
    ),
  );
});

test("detectTrackingColumns: the observed Shopify header has no carrier linkage", () => {
  assert.deepEqual(detectTrackingColumns(HEADER.split(",")), []);
});

test("detectTrackingColumns: 'Shipping Method' is not mistaken for carrier linkage", () => {
  assert.deepEqual(detectTrackingColumns(["Shipping Method", "Shipping City"]), []);
  assert.deepEqual(detectTrackingColumns(["Tracking Number"]), ["Tracking Number"]);
});

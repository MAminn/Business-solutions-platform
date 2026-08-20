/**
 * probe-shopify-orders-csv.ts
 *
 * Read-only dry run over a Shopify `orders_export.csv`. It parses, adapts, and
 * REPORTS. It decides nothing and changes nothing.
 *
 * Purpose: prove the Shopify CSV mapping and the universal order contract
 * against a real export BEFORE any schema exists, and measure how ready the
 * data is for a future Bosta shipment join. A single-line-item sample cannot
 * show multi-line-item fan-out, province-code coverage, or the real tag
 * vocabulary; this script turns those unknowns into measured facts.
 *
 * This script ONLY reports. Specifically:
 *   - ZERO database access. It imports no Prisma client and opens no connection.
 *   - ZERO network calls.
 *   - ZERO writes of any kind: no file is created, no schema, no migration.
 *   - It reads exactly one file, the path given on the command line.
 *
 * PII SAFETY. The adapter excludes PII by omission at the mapping boundary, so
 * no PII reaches this script's data structures. This script adds two further
 * rules: it never prints a raw CSV row, and for PII columns it prints only the
 * column NAME and a non-empty COUNT - never a value, not even truncated. City
 * and province ARE printed, because they are allowlisted location fields.
 *
 * Usage:
 *   npx tsx scripts/probe-shopify-orders-csv.ts tmp/orders_export.csv
 */

import { readFileSync } from "node:fs";
import {
  adaptShopifyCsv,
  detectTrackingColumns,
  isCarrierRelatedTag,
  CONSUMED_COLUMNS,
  PII_COLUMNS,
} from "@/lib/orders/shopify-csv";
import { parseCsv } from "@/lib/orders/csv";
import type { NormalizedOrder, OrderIssue } from "@/lib/orders/types";

const BOSTA_TAG = "bosta_synced";

// ---------------------------------------------------------------------------
// Small reporting helpers
// ---------------------------------------------------------------------------

function heading(title: string): void {
  console.log(`\n${"=".repeat(72)}`);
  console.log(title);
  console.log("=".repeat(72));
}

function row(label: string, value: string | number): void {
  console.log(`  ${label.padEnd(46)} ${value}`);
}

/** Count occurrences, returned most-frequent first. */
function tally(values: Array<string | null>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value === null || value === "" ? "(blank)" : value;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function printTally(
  label: string,
  values: Array<string | null>,
  limit = 30,
): void {
  const entries = tally(values);
  console.log(`\n  ${label} — ${entries.length} distinct`);
  for (const [value, count] of entries.slice(0, limit)) {
    console.log(`      ${String(count).padStart(6)}  ${value}`);
  }
  if (entries.length > limit) {
    console.log(`      ... ${entries.length - limit} more not shown`);
  }
}

/**
 * Describe an order number's SHAPE rather than its value, so formats can be
 * compared without listing every order. `#5402` -> `#D{4}`.
 *
 * Single pass over one alternation on purpose: replacing digits first and
 * letters second would re-match the `D` of a just-written `D{4}` placeholder.
 */
function orderNumberShape(orderNumber: string): string {
  return orderNumber.replace(/\d+|[A-Za-z]+/g, (run) =>
    /\d/.test(run) ? `D{${run.length}}` : `A{${run.length}}`,
  );
}

// ---------------------------------------------------------------------------
// Report sections
// ---------------------------------------------------------------------------

function reportFile(path: string, content: string, header: string[]): void {
  heading("FILE");
  row("path", path);
  row("bytes", content.length);
  row("encoding assumed", "utf-8");
  row("BOM present", content.charCodeAt(0) === 0xfeff ? "yes" : "no");
  row("line endings", content.includes("\r\n") ? "CRLF" : "LF");
  row("header columns", header.length);
}

function reportColumns(header: string[]): void {
  heading("COLUMN INVENTORY");

  const consumed = CONSUMED_COLUMNS.filter((column) => header.includes(column));
  const missingConsumed = CONSUMED_COLUMNS.filter(
    (column) => !header.includes(column),
  );
  const piiPresent = PII_COLUMNS.filter((column) => header.includes(column));
  const known = new Set<string>([...CONSUMED_COLUMNS, ...PII_COLUMNS]);
  const ignored = header.filter((column) => !known.has(column));

  row("columns consumed by the adapter", consumed.length);
  row("expected columns absent from this export", missingConsumed.length);
  for (const column of missingConsumed) {
    console.log(`      ABSENT  ${column}`);
  }

  console.log(
    `\n  PII columns DETECTED AND EXCLUDED — ${piiPresent.length} (names only; no values read or printed)`,
  );
  for (const column of piiPresent) {
    console.log(`      excluded  ${column}`);
  }

  console.log(
    `\n  Columns present but not mapped — ${ignored.length} (line-item detail, tax breakdown, out-of-scope)`,
  );
  for (const column of ignored) {
    console.log(`      unmapped  ${column}`);
  }
}

function reportCarrierLinkage(header: string[], orders: NormalizedOrder[]): void {
  heading("CARRIER LINKAGE — Bosta match readiness");

  const trackingColumns = detectTrackingColumns(header);
  if (trackingColumns.length === 0) {
    console.log(
      "\n  NO TRACKING-LIKE COLUMNS FOUND. This export carries no tracking number,\n" +
        "  carrier name, or fulfillment id. Shopify attaches tracking to the\n" +
        "  FULFILLMENT, not the order, so there is no carrier join key on the\n" +
        "  Shopify side. The linkage must come from Bosta's own merchant/business\n" +
        "  reference, which is what `matchKey` exists to be matched against.\n",
    );
    console.log(
      "  Note: 'Shipping Company' is the recipient's address company line, NOT a\n" +
        "  carrier. It is treated as PII and excluded.",
    );
  } else {
    console.log("\n  TRACKING-LIKE COLUMNS FOUND — revisit the join-key decision:");
    for (const column of trackingColumns) {
      console.log(`      ${column}`);
    }
  }

  const withKey = orders.filter((order) => order.matchKey !== "");
  const keyCounts = new Map<string, number>();
  for (const order of withKey) {
    keyCounts.set(order.matchKey, (keyCounts.get(order.matchKey) ?? 0) + 1);
  }
  const collisions = [...keyCounts.entries()].filter(([, count]) => count > 1);

  console.log("");
  row("orders with a usable matchKey", `${withKey.length} / ${orders.length}`);
  row("distinct matchKeys", keyCounts.size);
  row("matchKey collisions", collisions.length);
  for (const [key, count] of collisions.slice(0, 20)) {
    console.log(`      COLLISION  ${key} x${count}`);
  }

  printTally(
    "orderNumber formats (shape, not value)",
    orders.map((order) => orderNumberShape(order.orderNumber)),
  );

  const bostaTagged = orders.filter((order) =>
    order.tags.some((tag) => tag.toLowerCase() === BOSTA_TAG),
  );
  const pct =
    orders.length === 0
      ? "0.0"
      : ((bostaTagged.length / orders.length) * 100).toFixed(1);
  console.log("");
  row(`orders tagged '${BOSTA_TAG}'`, `${bostaTagged.length} / ${orders.length} (${pct}%)`);
  console.log(
    "      Orders without it likely have no Bosta shipment at all — the\n" +
      "      expected-orphan baseline for the future match.",
  );

  const carrierTags = orders
    .flatMap((order) => order.tags)
    .filter((tag) => isCarrierRelatedTag(tag));
  printTally("carrier-related tag vocabulary", carrierTags);
}

function reportOrders(orders: NormalizedOrder[], rowCount: number): void {
  heading("ORDERS");

  const externalIds = orders.map((order) => order.externalId);
  const distinctExternalIds = new Set(externalIds);
  const duplicateExternalIds = externalIds.length - distinctExternalIds.size;
  const fannedOut = orders.filter((order) => order.sourceRowCount > 1);

  row("total CSV data rows (excl. header)", rowCount);
  row("normalized orders", orders.length);
  row("distinct externalId", distinctExternalIds.size);
  row("duplicate externalId", duplicateExternalIds);
  row("orders spanning >1 CSV row (line-item fan-out)", fannedOut.length);
  row(
    "max CSV rows for one order",
    orders.reduce((max, order) => Math.max(max, order.sourceRowCount), 0),
  );

  if (fannedOut.length === 0 && orders.length > 0) {
    console.log(
      "\n      NOTE: no multi-line-item order in this sample, so the fan-out\n" +
        "      grouping path is UNVERIFIED against real data. Re-run on a fuller\n" +
        "      export before trusting order totals.",
    );
  }

  printTally("currency", orders.map((order) => order.currency));
  printTally("salesChannel (CSV 'Source')", orders.map((order) => order.salesChannel));
  printTally("rawShippingMethod", orders.map((order) => order.rawShippingMethod));
}

function reportStates(orders: NormalizedOrder[]): void {
  heading("STATE VOCABULARY (raw source values and derived states)");

  printTally("raw Financial Status", orders.map((order) => order.rawFinancialStatus));
  printTally("raw Fulfillment Status", orders.map((order) => order.rawFulfillmentStatus));
  printTally("raw Payment Method", orders.map((order) => order.rawPaymentMethod));

  printTally("derived paymentState", orders.map((order) => order.paymentState));
  printTally("derived fulfillmentState", orders.map((order) => order.fulfillmentState));
  printTally("derived paymentMethod", orders.map((order) => order.paymentMethod));

  const cod = orders.filter((order) => order.paymentMethod === "COD");
  const codPending = cod.filter((order) => order.paymentState === "PENDING");
  console.log("");
  row("COD orders", `${cod.length} / ${orders.length}`);
  row("COD orders with paymentState PENDING", codPending.length);
  if (codPending.length > 0) {
    console.log(
      "      Expected for COD: 'pending' is the normal healthy state, not a\n" +
        "      problem. Filtering revenue on PAID would report near zero.\n" +
        "      Actual cash collection is Bosta's truth, not Shopify's.",
    );
  }
}

function reportLocations(orders: NormalizedOrder[]): void {
  heading("LOCATION (allowlisted fields only — no street, no zip)");

  printTally("shipCountryCode", orders.map((order) => order.shipCountryCode));
  printTally("shipProvinceCode", orders.map((order) => order.shipProvinceCode));
  printTally("shipProvinceName", orders.map((order) => order.shipProvinceName));
  printTally("shipCity", orders.map((order) => order.shipCity), 40);
  printTally("resolved regionCode", orders.map((order) => order.regionCode));

  const mapped = orders.filter(
    (order) => order.regionCode !== null && !["UNMAPPED", "MISSING"].includes(order.regionCode),
  );
  const unmapped = orders.filter((order) => order.regionCode === "UNMAPPED");
  const missing = orders.filter((order) => order.regionCode === "MISSING");
  const outOfScope = orders.filter((order) => order.regionCode === null);

  console.log("");
  console.log(
    `  Of ${orders.length} orders: ${mapped.length} mapped to a governorate, ` +
      `${unmapped.length} UNMAPPED, ${missing.length} MISSING, ${outOfScope.length} non-Egypt.`,
  );
  console.log(
    "      UNMAPPED is our own alias debt (fixable). MISSING is an upstream\n" +
      "      collection problem (no alias will fix it). They stay separate.",
  );

  // Province code vs name agreement — validates the "code is the better key"
  // finding across the whole file rather than one row.
  const withBoth = orders.filter(
    (order) => order.shipProvinceCode !== null && order.shipProvinceName !== null,
  );
  const codeOnly = orders.filter(
    (order) => order.shipProvinceCode !== null && order.shipProvinceName === null,
  );
  const nameOnly = orders.filter(
    (order) => order.shipProvinceCode === null && order.shipProvinceName !== null,
  );
  console.log("");
  row("orders with BOTH province code and name", withBoth.length);
  row("orders with province code ONLY", codeOnly.length);
  row("orders with province name ONLY", nameOnly.length);
}

function reportIssues(issues: OrderIssue[]): void {
  heading("ISSUES");

  if (issues.length === 0) {
    console.log("\n  None.");
    return;
  }

  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) bySeverity[issue.severity]++;

  row("errors (order skipped)", bySeverity.error);
  row("warnings", bySeverity.warning);
  row("info", bySeverity.info);

  printTally("issue codes", issues.map((issue) => issue.code));

  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    console.log("\n  First errors:");
    for (const issue of errors.slice(0, 10)) {
      const where = issue.line !== undefined ? `line ${issue.line}` : "file";
      console.log(`      ${where} [${issue.code}] ${issue.message}`);
    }
  }
}

function reportVerdict(orders: NormalizedOrder[], issues: OrderIssue[]): void {
  heading("VERDICT — what this run does and does not establish");

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const fannedOut = orders.filter((order) => order.sourceRowCount > 1).length;

  console.log("");
  console.log(`  Established: ${orders.length} order(s) mapped, ${errors} skipped.`);
  console.log(
    "  Established: the Shopify CSV mapping and the universal order contract\n" +
      "  round-trip against this export with no PII retained.",
  );
  console.log(
    fannedOut > 0
      ? "  Established: multi-line-item fan-out grouping works on real data."
      : "  NOT established: multi-line-item fan-out — no such order in this sample.",
  );
  console.log(
    "  NOT established: province-code coverage across all 27 governorates, or\n" +
      "  the full tag vocabulary. Both need a larger export.",
  );
  console.log(
    "  NOT established: anything about delivery, returns, or COD cash\n" +
      "  collection. Those are Bosta's, and Bosta has not been probed.",
  );
  console.log("\n  No schema was created. No migration was created. Nothing was written.");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: npx tsx scripts/probe-shopify-orders-csv.ts <path-to-orders_export.csv>",
    );
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    console.error(`Could not read ${path}: ${(error as Error).message}`);
    process.exit(1);
  }

  // Parsed twice on purpose: once for the raw header inventory (which must see
  // PII column names to report them as excluded), once through the adapter
  // (which never reads their values).
  const table = parseCsv(content);
  const result = adaptShopifyCsv(content);

  console.log("\nShopify orders CSV — DRY RUN. Read-only. No database. No writes.");

  reportFile(path, content, table.header);
  reportColumns(table.header);
  reportOrders(result.orders, result.rowCount);
  reportStates(result.orders);
  reportLocations(result.orders);
  reportCarrierLinkage(table.header, result.orders);
  reportIssues(result.issues);
  reportVerdict(result.orders, result.issues);

  console.log("");
}

main();

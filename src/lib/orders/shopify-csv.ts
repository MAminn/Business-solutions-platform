/**
 * Shopify `orders_export.csv` adapter.
 *
 * Maps Shopify's export into the universal `NormalizedOrder` contract. This is
 * an EXPLICIT adapter, not a configurable column-mapping engine: a JSON mapping
 * config looks universal right up to the first source that needs row grouping
 * or a conditional, and Shopify's line-item fan-out is exactly that. One
 * adapter module per source, one shared output type.
 *
 * PII BOUNDARY. This module is the only place that sees a raw Shopify row, and
 * it never reads a PII column - the columns listed in `PII_COLUMNS` are simply
 * not referenced by `mapOrder`. That is the enforcement: exclusion by omission
 * at the mapping boundary, so PII never travels past this file even in memory.
 * `PII_COLUMNS` is exported for REPORTING only (so a dry run can state what was
 * present and skipped); it is never used to read a value.
 */

import { parseCsv, type CsvRecord } from "./csv";
import {
  cleanMoney,
  cleanString,
  deriveMatchKey,
  normalizeFulfillmentState,
  normalizePaymentMethod,
  normalizePaymentState,
  parseSourceTimestamp,
  splitTags,
} from "./normalize";
import type { AdapterResult, NormalizedOrder, OrderIssue } from "./types";
import { resolveEgyptRegion } from "@/lib/geo/egypt-regions";

/**
 * Columns that carry personal data and are NEVER read into a `NormalizedOrder`.
 *
 * `Shipping Company` and `Billing Company` are included deliberately: despite
 * the name, they are the company-name line of the recipient's ADDRESS block,
 * not the carrier. Mapping either onto a carrier field would be both wrong and
 * a PII leak.
 *
 * `Notes` and `Note Attributes` are free text that routinely contains phone
 * numbers and landmarks. `Payment Reference` / `Payment ID` / `Receipt Number`
 * are payment identifiers traceable to a person.
 */
export const PII_COLUMNS: readonly string[] = [
  "Email",
  "Phone",
  "Accepts Marketing",
  "Billing Name",
  "Billing Street",
  "Billing Address1",
  "Billing Address2",
  "Billing Company",
  "Billing City",
  "Billing Zip",
  "Billing Province",
  "Billing Province Name",
  "Billing Country",
  "Billing Phone",
  "Shipping Name",
  "Shipping Street",
  "Shipping Address1",
  "Shipping Address2",
  "Shipping Company",
  "Shipping Zip",
  "Shipping Phone",
  "Notes",
  "Note Attributes",
  "Payment Reference",
  "Payment References",
  "Payment ID",
  "Receipt Number",
  "Device ID",
  "Employee",
  "Risk Level",
];

/**
 * Column-name fragments that would indicate a carrier/tracking linkage.
 *
 * Used by the dry run to ASSERT their absence rather than to read them. The
 * observed export carries none: Shopify attaches tracking to the fulfillment,
 * not the order, so the orders export has no carrier join key at all.
 */
export const TRACKING_COLUMN_PATTERNS: readonly string[] = [
  "tracking",
  "awb",
  "waybill",
  "consignment",
  "carrier",
  "courier",
  "shipment",
];

/** Tag fragments suggesting carrier/delivery workflow involvement. */
const CARRIER_TAG_PATTERNS: readonly string[] = [
  "bosta",
  "aramex",
  "mylerz",
  "j&t",
  "fedex",
  "dhl",
  "courier",
  "shipping",
  "shipped",
  "fulfillment",
  "fulfilment",
  "delivery",
  "delivered",
  "return",
  "rto",
  "tracking",
  "confirmation",
];

/**
 * Detect columns whose NAME suggests a carrier linkage. Matching is on header
 * names only - no cell is read.
 */
export function detectTrackingColumns(header: readonly string[]): string[] {
  return header.filter((column) => {
    const lower = column.toLowerCase();
    // "Shipping Method" and the shipping ADDRESS columns are not carrier
    // linkage, so match the specific fragments rather than the word "ship".
    return TRACKING_COLUMN_PATTERNS.some((pattern) => lower.includes(pattern));
  });
}

/** True when a tag looks carrier/delivery related. Reporting aid only. */
export function isCarrierRelatedTag(tag: string): boolean {
  const lower = tag.toLowerCase();
  return CARRIER_TAG_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Shopify column names this adapter reads. Exported so a dry run can report. */
export const CONSUMED_COLUMNS: readonly string[] = [
  "Id",
  "Name",
  "Created at",
  "Paid at",
  "Fulfilled at",
  "Cancelled at",
  "Currency",
  "Total",
  "Subtotal",
  "Shipping",
  "Taxes",
  "Discount Amount",
  "Refunded Amount",
  "Outstanding Balance",
  "Lineitem quantity",
  "Shipping Country",
  "Shipping Province",
  "Shipping Province Name",
  "Shipping City",
  "Financial Status",
  "Fulfillment Status",
  "Payment Method",
  "Shipping Method",
  "Source",
  "Tags",
];

/** One order's physical CSV rows, plus the file line where it started. */
interface RowGroup {
  externalId: string;
  orderNumber: string;
  rows: CsvRecord[];
  line: number;
}

/**
 * Pick the first non-empty value for a column across an order's rows.
 *
 * Shopify writes order-level fields on the FIRST row of an order and blanks
 * them on line-item continuation rows. Taking the first non-empty value is
 * equivalent for well-formed exports and tolerant of reordered ones.
 */
function firstNonEmpty(rows: CsvRecord[], column: string): string | null {
  for (const row of rows) {
    const value = cleanString(row[column]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Group physical rows into orders.
 *
 * Shopify fans a multi-line-item order across several rows: the first carries
 * the order-level fields, and continuation rows carry only line-item columns.
 * Summing `Total` across raw rows would therefore multiply revenue by the
 * line-item count - grouping is a correctness requirement, not a convenience.
 *
 * Whether `Id` repeats on continuation rows is not knowable from a
 * single-line-item sample, so this handles BOTH shapes: a repeated `Id`
 * continues the current group, and a blank `Id` attaches to the current group.
 */
function groupRows(
  records: CsvRecord[],
  issues: OrderIssue[],
): RowGroup[] {
  const groups: RowGroup[] = [];
  const byExternalId = new Map<string, RowGroup>();
  let current: RowGroup | null = null;

  records.forEach((row, index) => {
    // +2: one for the header row, one to make it a 1-based file line number.
    const line = index + 2;
    const externalId = cleanString(row["Id"]);
    const orderNumber = cleanString(row["Name"]);

    if (externalId !== null) {
      if (current !== null && current.externalId === externalId) {
        current.rows.push(row);
        return;
      }

      const existing = byExternalId.get(externalId);
      if (existing !== undefined) {
        // Same order id reappearing after other orders intervened. Merge, but
        // say so - a well-formed Shopify export keeps an order's rows adjacent.
        issues.push({
          severity: "warning",
          code: "non_contiguous_order_rows",
          line,
          orderNumber: orderNumber ?? existing.orderNumber,
          message:
            "Rows for one order id are not adjacent in the file; merged into the earlier group.",
        });
        existing.rows.push(row);
        current = existing;
        return;
      }

      const group: RowGroup = {
        externalId,
        orderNumber: orderNumber ?? "",
        rows: [row],
        line,
      };
      groups.push(group);
      byExternalId.set(externalId, group);
      current = group;
      return;
    }

    // Blank `Id` - a line-item continuation row.
    if (current === null) {
      issues.push({
        severity: "error",
        code: "orphan_row_no_order_id",
        line,
        orderNumber: orderNumber ?? undefined,
        message: "Row has no order Id and follows no order; skipped.",
      });
      return;
    }

    if (
      orderNumber !== null &&
      current.orderNumber !== "" &&
      orderNumber !== current.orderNumber
    ) {
      // A continuation row naming a different order means the grouping
      // assumption is wrong for this export. Surface it loudly rather than
      // silently attaching line items to the wrong order.
      issues.push({
        severity: "error",
        code: "continuation_row_order_mismatch",
        line,
        orderNumber,
        message:
          "Row has no order Id but names a different order than the preceding row; skipped.",
      });
      return;
    }

    current.rows.push(row);
  });

  return groups;
}

/** Map one grouped order. Returns null when the order cannot be emitted. */
function mapOrder(group: RowGroup, issues: OrderIssue[]): NormalizedOrder | null {
  const orderNumber = firstNonEmpty(group.rows, "Name") ?? group.orderNumber;

  if (orderNumber === "") {
    issues.push({
      severity: "warning",
      code: "missing_order_number",
      line: group.line,
      message: "Order has no Name; matchKey will be empty and unmatchable.",
    });
  }

  const placedAt = parseSourceTimestamp(firstNonEmpty(group.rows, "Created at"));
  if (placedAt === null) {
    issues.push({
      severity: "error",
      code: "missing_or_invalid_created_at",
      line: group.line,
      orderNumber,
      message: "Order has no parseable 'Created at'; skipped.",
      value: firstNonEmpty(group.rows, "Created at") ?? "",
    });
    return null;
  }

  const currency = firstNonEmpty(group.rows, "Currency");
  if (currency === null) {
    issues.push({
      severity: "warning",
      code: "missing_currency",
      line: group.line,
      orderNumber,
      message: "Order has no Currency.",
    });
  }

  const totalAmount = cleanMoney(firstNonEmpty(group.rows, "Total"));
  if (totalAmount === null) {
    issues.push({
      severity: "error",
      code: "missing_or_invalid_total",
      line: group.line,
      orderNumber,
      message: "Order has no parseable Total; skipped.",
      value: firstNonEmpty(group.rows, "Total") ?? "",
    });
    return null;
  }

  const refundedAmount = cleanMoney(firstNonEmpty(group.rows, "Refunded Amount"));
  const cancelledAt = parseSourceTimestamp(firstNonEmpty(group.rows, "Cancelled at"));
  const fulfilledAt = parseSourceTimestamp(firstNonEmpty(group.rows, "Fulfilled at"));

  const rawFinancialStatus = firstNonEmpty(group.rows, "Financial Status");
  const rawFulfillmentStatus = firstNonEmpty(group.rows, "Fulfillment Status");
  const rawPaymentMethod = firstNonEmpty(group.rows, "Payment Method");

  const paymentMethod = normalizePaymentMethod(rawPaymentMethod);
  if (paymentMethod.unrecognized) {
    issues.push({
      severity: "warning",
      code: "unknown_payment_method",
      line: group.line,
      orderNumber,
      message: "Payment method matched no known gateway pattern; recorded as UNKNOWN.",
      value: rawPaymentMethod ?? "",
    });
  }

  const paymentState = normalizePaymentState({
    financialStatus: rawFinancialStatus,
    refundedAmount,
    totalAmount,
  });
  if (paymentState.unrecognized) {
    issues.push({
      severity: "warning",
      code: "unknown_financial_status",
      line: group.line,
      orderNumber,
      message: "Financial status matched no known value; recorded as UNKNOWN.",
      value: rawFinancialStatus ?? "",
    });
  }

  const fulfillmentState = normalizeFulfillmentState({
    fulfillmentStatus: rawFulfillmentStatus,
    cancelledAt,
    fulfilledAt,
  });
  if (fulfillmentState.unrecognized) {
    issues.push({
      severity: "warning",
      code: "unknown_fulfillment_status",
      line: group.line,
      orderNumber,
      message: "Fulfillment status matched no known value; recorded as UNFULFILLED.",
      value: rawFulfillmentStatus ?? "",
    });
  }

  // Allowlisted location only. Street, zip, name, and phone are never read.
  const shipCountryCode = firstNonEmpty(group.rows, "Shipping Country");
  const shipProvinceCode = firstNonEmpty(group.rows, "Shipping Province");
  const shipProvinceName = firstNonEmpty(group.rows, "Shipping Province Name");
  const shipCity = firstNonEmpty(group.rows, "Shipping City");

  const region = resolveEgyptRegion({
    countryCode: shipCountryCode,
    provinceCode: shipProvinceCode,
    provinceName: shipProvinceName,
    city: shipCity,
  });

  if (region.status === "UNMAPPED") {
    issues.push({
      severity: "warning",
      code: "region_unmapped",
      line: group.line,
      orderNumber,
      message:
        "Shipping location present but matched no governorate; needs an alias.",
      value: shipProvinceCode ?? shipProvinceName ?? "",
    });
  } else if (region.status === "MISSING") {
    issues.push({
      severity: "warning",
      code: "region_missing",
      line: group.line,
      orderNumber,
      message: "Order has no shipping location values at all.",
    });
  }

  let itemCount = 0;
  for (const row of group.rows) {
    const quantity = Number(cleanString(row["Lineitem quantity"]) ?? "0");
    if (Number.isFinite(quantity)) itemCount += quantity;
  }

  return {
    externalId: group.externalId,
    orderNumber,
    matchKey: deriveMatchKey(orderNumber),

    placedAt,
    paidAt: parseSourceTimestamp(firstNonEmpty(group.rows, "Paid at")),
    fulfilledAt,
    cancelledAt,

    currency: currency ?? "",
    totalAmount,
    subtotalAmount: cleanMoney(firstNonEmpty(group.rows, "Subtotal")),
    shippingAmount: cleanMoney(firstNonEmpty(group.rows, "Shipping")),
    taxAmount: cleanMoney(firstNonEmpty(group.rows, "Taxes")),
    discountAmount: cleanMoney(firstNonEmpty(group.rows, "Discount Amount")),
    refundedAmount,
    outstandingAmount: cleanMoney(firstNonEmpty(group.rows, "Outstanding Balance")),

    itemCount,
    sourceRowCount: group.rows.length,

    shipCountryCode,
    shipProvinceCode,
    shipProvinceName,
    shipCity,
    regionCode: region.code,

    rawFinancialStatus,
    rawFulfillmentStatus,
    rawPaymentMethod,
    rawShippingMethod: firstNonEmpty(group.rows, "Shipping Method"),
    salesChannel: firstNonEmpty(group.rows, "Source"),
    tags: splitTags(firstNonEmpty(group.rows, "Tags")),

    paymentState: paymentState.state,
    fulfillmentState: fulfillmentState.state,
    paymentMethod: paymentMethod.method,
  };
}

export interface ShopifyCsvAdapterResult extends AdapterResult {
  /** Header names in file order, for reporting. */
  header: string[];
  /** Physical data rows read, excluding the header. */
  rowCount: number;
  /** 1-based file lines whose cell count did not match the header. */
  raggedRows: number[];
}

/**
 * Parse and adapt a Shopify orders export.
 *
 * Pure: no I/O, no database, no network. The caller supplies file contents.
 */
export function adaptShopifyCsv(content: string): ShopifyCsvAdapterResult {
  const table = parseCsv(content);
  const issues: OrderIssue[] = [];

  if (table.header.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_file",
      message: "File contains no header row.",
    });
    return { orders: [], issues, header: [], rowCount: 0, raggedRows: [] };
  }

  for (const column of ["Id", "Name", "Created at", "Total"]) {
    if (!table.header.includes(column)) {
      issues.push({
        severity: "error",
        code: "missing_required_column",
        message: `Export is missing the required column '${column}'.`,
        value: column,
      });
    }
  }

  for (const line of table.raggedRows) {
    issues.push({
      severity: "warning",
      code: "ragged_row",
      line,
      message: "Row cell count does not match the header; missing cells read as empty.",
    });
  }

  const groups = groupRows(table.records, issues);
  const orders: NormalizedOrder[] = [];

  for (const group of groups) {
    const order = mapOrder(group, issues);
    if (order !== null) orders.push(order);
  }

  return {
    orders,
    issues,
    header: table.header,
    rowCount: table.rowCount,
    raggedRows: table.raggedRows,
  };
}

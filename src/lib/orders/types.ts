/**
 * Universal order contract.
 *
 * `NormalizedOrder` is the single shape every order source produces, whatever
 * its transport: Shopify CSV today, custom-website CSV/API and the Shopify
 * OAuth API later. Adapters map INTO this type; nothing downstream ever sees a
 * source-specific record.
 *
 * Three rules this type exists to enforce, all from
 * `docs/order-ingestion-contract.md`:
 *
 *   1. NO PII. There is deliberately no field for email, phone, customer or
 *      billing name, street/address lines, zip, notes, or payment references.
 *      The exclusion happens in the adapter, before a `NormalizedOrder` exists,
 *      so PII is never carried even in memory past the mapping boundary.
 *   2. NO raw passthrough. There is no `raw: unknown` / `raw: Json` escape
 *      hatch, unlike sibling models such as `Ad` and `InsightsDaily`. A raw
 *      blob of a Shopify order row IS a customer record; an allowlist of named
 *      fields is the only safe shape.
 *   3. Commercial truth only. This describes what was ORDERED and what was
 *      CHARGED. It says nothing about whether a parcel was delivered or whether
 *      COD cash was collected - that is Bosta's, and is why there is no
 *      `DELIVERED` state and no `codCollected` field here.
 */

/**
 * Payment state, normalized across sources.
 *
 * Deliberately kept ORTHOGONAL to `OrderFulfillmentState`. For a COD store,
 * "fulfilled but not yet paid" is the normal happy path, not a contradiction -
 * collapsing both axes into one lifecycle enum would force one of them to be
 * discarded. See `docs/order-ingestion-contract.md`.
 */
export type OrderPaymentState =
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED"
  | "VOIDED"
  | "UNKNOWN";

/**
 * Fulfillment state, normalized across sources.
 *
 * There is deliberately NO `DELIVERED` value. Shopify's export carries no
 * delivery event, so a `DELIVERED` member would be permanently unreachable -
 * a value that can never be set is a lie in the contract that later readers
 * will trust. Delivery outcome belongs to the carrier layer (Bosta) and will
 * live on a separate shipment model. Adding an enum value later is additive.
 */
export type OrderFulfillmentState =
  | "UNFULFILLED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "RETURNED"
  | "CANCELLED";

/**
 * Payment method, normalized across sources.
 *
 * `COD` is the load-bearing member: for an Egyptian COD store, payment state
 * stays `PENDING` through a perfectly healthy order lifecycle, so COD orders
 * must be identifiable without reference to payment state.
 */
export type OrderPaymentMethod =
  | "COD"
  | "CARD"
  | "WALLET"
  | "BANK_TRANSFER"
  | "GIFT_CARD"
  | "OTHER"
  | "UNKNOWN";

/** Severity of a mapping issue. `error` means the order was not emitted. */
export type OrderIssueSeverity = "error" | "warning" | "info";

/**
 * A problem encountered while mapping. Issues are SURFACED, never swallowed:
 * an unrecognised payment method or an unmappable region produces an issue plus
 * an explicit `UNKNOWN`/sentinel value, never a silent default.
 *
 * `value` carries the offending source string for diagnosis, so an issue MUST
 * NOT be raised on a PII-bearing column - no such column reaches this layer.
 */
export interface OrderIssue {
  severity: OrderIssueSeverity;
  /** Stable machine code, e.g. `unknown_payment_method`. */
  code: string;
  /** 1-based CSV line number, when the issue is traceable to one row. */
  line?: number;
  /** Order number, for locating the record. Never a customer identifier. */
  orderNumber?: string;
  /** Human-readable explanation. */
  message: string;
  /** The offending source value, when safe to echo. */
  value?: string;
}

/**
 * One order, normalized. Money is carried as `string` in minor-unit-safe
 * decimal form exactly as the source wrote it (e.g. `"2569.00"`), never as a
 * JS `number`: binary floating point cannot represent decimal currency exactly,
 * and the eventual column is `Decimal(12,2)`. Parsing to `number` happens only
 * for comparisons, never for storage.
 */
export interface NormalizedOrder {
  // -- Identity ------------------------------------------------------------
  /**
   * The source's immutable primary key. Shopify's numeric `Id`, NOT `Name`:
   * `Name` is merchant-configurable, can be re-sequenced, and is not guaranteed
   * unique for the lifetime of a store. `Id` is also what the future Shopify
   * API adapter returns, so keying on it now means the CSV-to-API migration
   * does not re-key a single row.
   */
  externalId: string;
  /** Human-facing order number exactly as written, e.g. `#5402`. Display only. */
  orderNumber: string;
  /**
   * Normalized `orderNumber`, the surface a future Bosta shipment matches on:
   * `#` stripped, trimmed, lowercased, internal whitespace collapsed.
   *
   * This exists ONLY to prepare carrier matching. The current Shopify export
   * carries no tracking number and no carrier join key, so the linkage must
   * come from the Bosta side (most likely its merchant/business reference).
   * Storing a normalized key on the order side means that whatever Bosta turns
   * out to send, the order model does not have to change.
   *
   * Uniqueness is per client, not global. The dry run only reports collisions.
   */
  matchKey: string;

  // -- Timestamps ----------------------------------------------------------
  /** When the order was placed. Parsed to a UTC instant from the source offset. */
  placedAt: Date;
  /** When payment was captured. Null for an uncollected COD order. */
  paidAt: Date | null;
  fulfilledAt: Date | null;
  cancelledAt: Date | null;

  // -- Money ---------------------------------------------------------------
  /** ISO 4217, e.g. `EGP`. */
  currency: string;
  totalAmount: string;
  subtotalAmount: string | null;
  shippingAmount: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
  refundedAmount: string | null;
  /**
   * Amount still owed. For a COD order this equals the total until the courier
   * remits, which makes it the clearest COD-exposure figure available from the
   * commercial source.
   */
  outstandingAmount: string | null;

  // -- Contents ------------------------------------------------------------
  /**
   * Summed line-item quantity. Line-item DETAIL (product, SKU, price) is out of
   * scope for this slice; only the count is carried.
   */
  itemCount: number;
  /** Physical CSV rows this order was assembled from. 1 unless fanned out. */
  sourceRowCount: number;

  // -- Location (allowlisted; no street, no zip) ---------------------------
  /** ISO 3166-1 alpha-2, e.g. `EG`. */
  shipCountryCode: string | null;
  /** ISO 3166-2 subdivision code without prefix, e.g. `C`. Preferred region key. */
  shipProvinceCode: string | null;
  /** Province display name, e.g. `Cairo`. Fallback region key. */
  shipProvinceName: string | null;
  /** City/district as written by the customer. Often Arabic, often a district. */
  shipCity: string | null;
  /**
   * Canonical governorate code (`EG-C`), a sentinel (`UNMAPPED` / `MISSING`),
   * or null for non-Egypt orders. A REGENERABLE derived value: raw location
   * fields above are the source of truth, and re-deriving this after an alias
   * is added is a derived-column refresh, not a rewrite of stored history.
   */
  regionCode: string | null;

  // -- Source-verbatim descriptors -----------------------------------------
  /** Shopify `Financial Status`, verbatim. */
  rawFinancialStatus: string | null;
  /** Shopify `Fulfillment Status`, verbatim. */
  rawFulfillmentStatus: string | null;
  /** Shopify `Payment Method` - a merchant-configurable gateway display name. */
  rawPaymentMethod: string | null;
  /** Shopify `Shipping Method`, e.g. `Normal Shipping "2-5d"`. Service level. */
  rawShippingMethod: string | null;
  /**
   * Shopify `Source` - the SALES CHANNEL (`web`, `pos`, ...), not the order
   * source system. Named `salesChannel` to keep it from being confused with
   * `OrderSourceConnection`.
   */
  salesChannel: string | null;
  /**
   * Order tags, split and trimmed, verbatim otherwise.
   *
   * Tags DO NOT feed `paymentState` or `fulfillmentState`. They are
   * merchant-defined free text, per-store and unversioned - this store's are
   * injected by a Bosta app and one contains an emoji. Deriving canonical state
   * from them would hard-code one merchant's workflow into the shared model and
   * break silently the day a tag is renamed in Shopify admin.
   */
  tags: string[];

  // -- Derived (regenerable from the verbatim fields above) ----------------
  paymentState: OrderPaymentState;
  fulfillmentState: OrderFulfillmentState;
  paymentMethod: OrderPaymentMethod;
}

/**
 * What every source adapter returns. Orders that could not be mapped are absent
 * from `orders` and explained in `issues` - an adapter never emits a partial or
 * placeholder order.
 */
export interface AdapterResult {
  orders: NormalizedOrder[];
  issues: OrderIssue[];
}

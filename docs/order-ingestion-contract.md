# Order Ingestion Contract — Shopify / custom orders, and the delivery-layer boundary

**Type:** Reference decision record
**Status:** Accepted — recorded 2026-08-20
**Scope:** L2-A. Defines the universal order contract and the Shopify CSV mapping. Creates no schema, no migration, and no database write.
**Related code:** `src/lib/orders/*`, `src/lib/geo/egypt-regions.ts`, `scripts/probe-shopify-orders-csv.ts`
**Related decisions:** `docs/location-intelligence-egypt-regions.md`

---

## 1. Three sources, three kinds of truth

The platform ingests from three independent systems. They answer different
questions, and conflating any two of them produces a number that looks
authoritative and is wrong.

| Source | Owns | Answers |
|---|---|---|
| **Meta** | Ad delivery and cost | Where budget was *delivered*, what attention cost — spend, impressions, clicks |
| **Shopify / custom website** | Commercial order truth | What was *ordered* and what was *charged* — order id, number, date, total, currency, payment method, Shopify's own financial/fulfillment status, shipping province and city |
| **Bosta** | Delivery and COD cash truth | What was *delivered* — delivery success and failure, attempts, returns and rejections, actual delivery status, COD collected and settled, courier tracking |

**Decision: these are three separate ingestion layers with separate models. An
order source is never a carrier, and a carrier is never an order source.**

Bosta is specifically **not** another `OrderSource`. It does not create orders
and it does not know what an order is worth commercially. It knows what happened
to a parcel and whether cash came back. Modelling it as an order source would
put two different facts in one table and force one of them to be discarded.

## 2. Shopify CSV is commercial truth, not delivery truth

The Shopify orders export tells us an order exists, what it is worth, where it
is going, and what Shopify believes about its payment and fulfillment. That is
the commercial record and it is complete on its own terms.

It does **not** tell us:

- whether the parcel was delivered
- how many delivery attempts were made
- whether the customer rejected it or it went RTO
- whether the COD cash was collected, and when it was settled

**Decision: no delivery or cash-collection fact is ever derived from the Shopify
export.** Where the export appears to imply one — a `fulfilled` status, a
`Fulfilled at` timestamp — it means the merchant handed the parcel to a courier,
not that a customer received it.

This is why `OrderFulfillmentState` has **no `DELIVERED` member**. Shopify's
export carries no delivery event, so a `DELIVERED` value would be permanently
unreachable, and a value that can never be set is a lie in the contract that
later readers will trust. Delivery outcome belongs to the carrier layer.

### 2.1 The COD consequence

The observed store is cash-on-delivery. Its orders arrive with
`Financial Status = pending`, `Fulfillment Status = fulfilled`, `Paid at` empty,
and `Outstanding Balance` equal to the full total.

**`pending` is the normal, healthy state for a COD order.** A revenue filter of
`financial_status = paid` would report approximately **zero revenue** for this
merchant. Any revenue query written against this source must account for that.

This is also why payment state and fulfillment state are modelled as **two
orthogonal axes** rather than one `lifecycle` enum. For a COD store, "fulfilled
but not yet paid" is the modal state, not a contradiction — a single enum forces
one of the two facts to be thrown away.

## 3. There is no carrier join key on the Shopify side

All 79 columns of the observed export were inventoried. **It contains no
tracking number, no tracking company, no tracking URL, and no fulfillment id.**
Shopify attaches tracking to the *fulfillment*, which this export does not cover.

The only Bosta trace in the Shopify data is the `bosta_synced` order tag — a
presence flag, not an identifier. It says a shipment probably exists. It cannot
say which one.

> **Trap, recorded so nobody hits it twice:** `Shipping Company` is **not** the
> carrier. It is the company-name line of the recipient's address block. It is
> PII, it is excluded, and mapping it to a carrier field would be both wrong and
> a leak.

**Decision: the order-to-shipment linkage must come from the Bosta side**, most
likely its merchant/business reference. Which field, and what it actually
contains, is the single most important question for the Bosta probe.

## 4. `matchKey` — preparing the join without depending on it

Every `NormalizedOrder` carries a `matchKey`: the order number normalized by
stripping a leading `#`, trimming, lowercasing, and collapsing internal
whitespace. `#5402` becomes `5402`.

Lowercasing and whitespace collapsing are deliberate: stores prefix order names
with letters, and merchant references get re-keyed by hand into courier
dashboards, so neither case nor spacing survives reliably.

**Decision: the order model carries a normalized match key; the LINK itself
lives on the shipment side.** A future `ClientShipment` will hold a nullable
`clientOrderId` plus a recorded match strategy. Two consequences, both
intentional:

- **The order schema does not change when Bosta lands.** Whatever Bosta turns
  out to send, the join is resolved on the shipment side.
- **An orphan shipment is a first-class state.** Shipments arrive independently
  of orders and can precede them, or exist for orders never imported. Orphans
  are surfaced with counts, never dropped and never guessed into a match.

Match keys are unique **per client**, not globally — order numbers are unique
per store only. The dry run reports collisions rather than assuming there are
none.

**Explicitly rejected:** fuzzy matching on amount + city + date. That
manufactures links out of coincidence, the same failure mode as the pro-rata
distribution rejected in the region record §5. If no key matches, the shipment
stays orphaned and appears in a work queue.

## 5. No PII, enforced at the adapter boundary

**Decision: customer personal data is never stored, and never travels past the
mapping boundary even in memory.**

Never retained: email, phone (any), customer name, billing name, street and
address lines, company lines, zip, notes, note attributes, payment references,
payment ids, receipt numbers, device id.

Retained location, and only this: **country code, province code, province name,
city.**

The enforcement is **exclusion by omission**: `src/lib/orders/shopify-csv.ts` is
the only module that sees a raw order row, and it simply never reads a PII
column. `PII_COLUMNS` exists so a dry run can *report* what was present and
skipped; it is never used to read a value.

### 5.1 No `raw` JSON column — for orders or shipments

Sibling models in this schema (`Ad`, `InsightsDaily`, `InsightsBreakdownDaily`)
carry a `raw Json?` passthrough. **`ClientOrder` and `ClientShipment` must not.**

A raw Shopify order row *is* a customer record. A raw Bosta shipment payload is
worse — it is receiver-centric, carrying name, phone, second phone, and full
street address. A `raw` column would re-introduce every field the allowlist
excludes, through the back door, at the persistence layer.

This extends to logging. **Raw Bosta webhook bodies must never be persisted,
including for debugging** — that puts customer records in log storage with no
retention policy and no deletion path. Redact at the edge, before the first log
line.

### 5.2 Bosta's PII surface is larger

When the carrier layer is built, the exclusion list grows: receiver full/first/
last name, phone, second phone, email, drop-off address first and second line,
building number, floor, apartment, delivery notes, and package description
(which routinely contains customer identifiers). Allowed: city, zone/district,
governorate.

## 6. Region resolution: prefer the code

Shopify emits the province as an **ISO 3166-2 subdivision code without its
prefix**. The observed order carries `Shipping Country = EG` and
`Shipping Province = C`, which compose directly into `EG-C` — exactly the
canonical key locked in the region record §3.

**Decision: country code + province code is the preferred region key.** The
province *name* is a display string with the same fragility as Meta's own
region strings; the code needs no matching, no transliteration, and no alias.

Resolution precedence:

1. Country + province **code** → `EG-C`
2. Province **name**, exact canonical match, when the code is blank
3. `UNMAPPED` when a location string was present but matched nothing
4. `MISSING` when there was no location value at all
5. `null` / out-of-scope for non-Egypt orders

**City is deliberately not used to infer a governorate.** District-level
aliasing is a many-to-one table that does not exist yet. The observed order
ships to an Arabic district name, and guessing it onto `EG-C` without the table
would be exactly the silent invention the region record §7 forbids. City
presence only decides `UNMAPPED` versus `MISSING`.

Non-Egypt orders resolve to `OUT_OF_SCOPE`, **not** `UNMAPPED` — no alias can
ever fix them, so folding them in would poison the alias work queue.

Raw `shipProvinceCode`, `shipProvinceName`, and `shipCity` are all retained.
`regionCode` is a **regenerable derived value**: re-deriving it after an alias
is added is a derived-column refresh, not a rewrite of stored history, so it
does not conflict with the region record's read-side normalization rule.

**Confidence:** the province-code finding rests on one sample row. Coverage
across all 27 governorates and the blank-rate of that column are measured by the
dry run against a fuller export, not assumed.

## 7. Tags are stored, never interpreted as lifecycle

Order tags are captured verbatim into `tags[]`. **Decision: tags never feed
`paymentState` or `fulfillmentState`.**

Tags are merchant-defined free text, per-store and unversioned. The observed
order's tags are injected by a Bosta app and one contains an emoji
(`✓ Fulfillment Notified`). Deriving canonical state from them would hard-code
one merchant's workflow into the shared model and break silently the day someone
renames a tag in Shopify admin.

If tag-driven state is wanted later, the right home is a **per-connection** tag
rule map on the source connection — never a global constant.

## 8. Two revenue concepts, permanently

Once the carrier layer lands there will be **two different revenue numbers for
the same order**, and both will be correct:

| Number | Source | Nature |
|---|---|---|
| **Order value** | Shopify | Commercial, immediate, known at checkout |
| **Collected COD** | Bosta | Cash, lagging, lower, known at delivery or settlement |

**Decision: these are separate, separately labelled figures. Neither is
presented as the other, and neither is silently substituted for the other.**

The gap between them is not an error to reconcile away — **it is the
delivery-failure and return rate**, which for an Egyptian COD business is
arguably the most valuable number this platform produces. Collapsing the two
into one "revenue" figure destroys exactly that signal.

Consistent with the region record §8, any figure that joins Meta delivery cost
to order-side revenue remains **blended and directional**, never presented as
attributed ROAS, CPA, or revenue.

## 9. Sequencing: what is deliberately delayed

**`ClientOrder` / `OrderSourceConnection` schema is delayed** until the dry run
confirms real CSV behaviour on a fuller export — specifically multi-line-item
fan-out. Shopify fans one order across several rows, blanking order-level fields
on continuation rows; summing `Total` across raw rows would multiply revenue by
the line-item count. The single-line-item sample cannot demonstrate this, so the
grouping path is written and unit-tested but **unverified against real data**.
The schema is designed; it is not committed on an unvalidated assumption.

**`CarrierConnection` / `ClientShipment` / `ShipmentEvent` schema is delayed**
until a Bosta probe confirms the linkage field and the complete state
vocabulary. A state enum built without the real vocabulary guarantees a rewrite,
and a partial vocabulary silently drops states.

Because the join lives on the shipment side (§4), these two are **independently
unblockable** — the order schema does not wait on Bosta.

Planned shape when it lands:

```
OrderSourceConnection -> ClientOrder            (Shopify / custom)
CarrierConnection     -> ClientShipment          (Bosta)
                         ClientShipment -> ShipmentEvent   (append-only)
```

`ShipmentEvent` is append-only and is the only thing that can answer "how many
delivery attempts" and "when was cash actually collected".
`ClientShipment.currentState` is a regenerable derived column over that log.

## 10. Bosta probe — what must be answered before schema

In priority order. The first item is load-bearing for everything else.

1. **Which field carries the Shopify linkage** — does the business/merchant
   reference hold `#5402`, the numeric `Id`, or something else?
2. One full shipment payload, redacted — field inventory and PII surface
3. **The complete state vocabulary**, including RTO, rejected, cancelled, and
   any settlement state
4. One webhook payload, and whether the model is webhook or polling
5. Whether COD **collected** and **settled** amounts are exposed at all, and at
   which event — if they are not, this whole layer's premise needs revisiting
6. Auth model, rate limits, historical backfill availability

Two fields, not one: `codAmountDue` and `codAmountCollected`. "COD amount" is
ambiguous, and conflating the two destroys the exact number the carrier layer
exists to produce. RTO must stay distinct from customer-rejected — different
causes, different owners, different fixes.

## 11. Not decided here / out of scope

- Line-item detail (product, SKU, price). Only `itemCount` is carried; the
  grouping logic built here is what a later `ClientOrderItem` would reuse.
- The district-level alias table (region record §6) and its storage.
- Any order, shipment, or location UI.
- Custom-website adapter specifics. The contract supports it; no source exists.
- Everything Bosta: models, adapters, matching, webhooks, reconciliation.

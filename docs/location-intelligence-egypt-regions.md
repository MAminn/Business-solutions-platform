# Location Intelligence — Egypt Region Normalization

**Type:** Reference decision record
**Status:** Accepted — recorded 2026-08-20
**Scope:** Documentation only. Records decisions; implements nothing.
**Related code:** `src/lib/meta/sync-breakdowns.ts` (`syncRegionBreakdown`, `REGION_CONFIG`), `src/lib/meta/client.ts` (`MetaBreakdown` = `"region"`), `src/app/api/cron/sync-breakdowns?dimension=region`

---

## 1. What was probed and confirmed

Meta `region` breakdown values were probed against a live ad account and then synced
successfully into `InsightsBreakdownDaily` under `dimension = REGION`, at `ACCOUNT`
entity level, via the manual `/api/cron/sync-breakdowns?dimension=region` route.

Confirmed by that probe and sync:

- The `region` breakdown is accepted by Meta as a **standalone** breakdown (unlike
  `platform_position`, which had to be paired with `publisher_platform`).
- Meta returns **27 Egypt governorates plus an `Unknown` bucket** — 28 distinct values.
- Values are **clean English strings** in the consistent format `"{Name} Governorate"`
  (with one lexical exception, noted in §4).
- `spend`, `impressions`, and `clicks` are populated and usable.
- **`purchases` and `conversionValue` are `0` on REGION rows.**

## 2. The load-bearing finding: Meta REGION carries no revenue

Meta does not attribute conversions to the geo split the way it does to the platform
and placement splits. Every REGION row came back with `purchases = 0` and
`conversionValue = 0`.

**Consequences, decided:**

- **Meta REGION cannot power a purchase or revenue heatmap on its own.** A map
  coloured by "sales by governorate" built from this data alone would be coloured by
  zeros. This is not a bug in the sync, and must never be "fixed" by inferring revenue
  from spend.
- **Meta REGION is to be treated strictly as ad-delivery data:** where budget was
  *delivered* and where attention was *bought* — spend, impressions, clicks, and the
  ratios derivable from them (CPM, CPC, CTR). Nothing downstream of a click.
- **Purchases and revenue by location must come from the order side** — shipping
  address or customer location on real orders — not from Meta.
- Zero purchases on a REGION row with non-zero spend/impressions is **expected and
  valid**. It must not be treated as a sync failure, raise a data-quality alert, or
  cause the row to be suppressed.

The interesting number is therefore a **join**: Meta delivery cost per governorate
against order-side revenue per governorate. That join is the whole reason this
document exists, and §3–§8 are the rules that make it survivable.

## 3. Canonical keys: ISO 3166-2:EG

Meta's display strings are a **vendor presentation format, not a key**. They are
Meta's to change. The order side will never produce them verbatim. Joining on raw
display strings would couple our geography to one vendor's copywriting.

**Decision: the canonical key for an Egyptian governorate is its ISO 3166-2:EG code.**
Meta strings map *into* that key; order-side strings map *into* the same key; the join
happens on the code, never on a display string.

The raw Meta value continues to be stored verbatim in `InsightsBreakdownDaily.value`
(see `REGION_CONFIG.buildValue`). **Normalization is a read-side concern.** Stored
history is never rewritten, so correcting a mapping never requires a backfill.

### 3.1 Meta value → canonical code

| # | Meta `region` value | Canonical code | Canonical name |
|---|---|---|---|
| 1 | `Cairo Governorate` | `EG-C` | Cairo |
| 2 | `Giza Governorate` | `EG-GZ` | Giza |
| 3 | `Alexandria Governorate` | `EG-ALX` | Alexandria |
| 4 | `Qalyubia Governorate` | `EG-KB` | Qalyubia |
| 5 | `Dakahlia Governorate` | `EG-DK` | Dakahlia |
| 6 | `Al Sharqia Governorate` | `EG-SHR` | Sharqia |
| 7 | `Gharbia Governorate` | `EG-GH` | Gharbia |
| 8 | `Beheira Governorate` | `EG-BH` | Beheira |
| 9 | `Monufia Governorate` | `EG-MNF` | Monufia |
| 10 | `Damietta Governorate` | `EG-DT` | Damietta |
| 11 | `Kafr el-Sheikh Governorate` | `EG-KFS` | Kafr el-Sheikh |
| 12 | `Red Sea Governorate` | `EG-BA` | Red Sea |
| 13 | `Ismailia Governorate` | `EG-IS` | Ismailia |
| 14 | `Minya Governorate` | `EG-MN` | Minya |
| 15 | `Suez Governorate` | `EG-SUZ` | Suez |
| 16 | `Sohag Governorate` | `EG-SHG` | Sohag |
| 17 | `Faiyum Governorate` | `EG-FYM` | Faiyum |
| 18 | `Beni Suef Governorate` | `EG-BNS` | Beni Suef |
| 19 | `Port Said Governorate` | `EG-PTS` | Port Said |
| 20 | `Asyut Governorate` | `EG-AST` | Asyut |
| 21 | `South Sinai Governorate` | `EG-JS` | South Sinai |
| 22 | `Matrouh Governorate` | `EG-MT` | Matrouh |
| 23 | `Qena Governorate` | `EG-KN` | Qena |
| 24 | `Luxor Governorate` | `EG-LX` | Luxor |
| 25 | `Aswan Governorate` | `EG-ASN` | Aswan |
| 26 | `New Valley Governorate` | `EG-WAD` | New Valley |
| 27 | `North Sinai Governorate` | `EG-SIN` | North Sinai |
| 28 | `Unknown` | `EG-UNKNOWN` | Unknown (see §5) |

Rows 1–27 are the 27 Egyptian governorates; row 28 is Meta's own catch-all. This is
the complete observed set.

The ISO codes are **not derivable** from the English names by any rule — `EG-BA` for
Red Sea (*Al Bahr al Ahmar*), `EG-KB` for Qalyubia, `EG-JS` for South Sinai (*Janub
Sina*), `EG-WAD` for New Valley (*Al Wadi al Jadid*), `EG-SIN` for North Sinai. They
derive from the Arabic names. **The mapping is a lookup table, never an algorithm.**

## 4. Do not derive the mapping by string manipulation

It is tempting to strip the `" Governorate"` suffix and slug the remainder. Do not.
Even inside this one clean 28-value set, Meta's own strings break the pattern:

- **`Al Sharqia Governorate`** carries an `"Al "` article prefix that the other 26 do
  not. Strip-and-slug yields `al-sharqia` for one governorate and bare names for the
  rest.
- **`Kafr el-Sheikh Governorate`** uses a lowercase `el-` particle and an internal
  hyphen, so casing and token rules that work elsewhere fail here.
- **`Unknown`** has no `" Governorate"` suffix at all, so the strip is a no-op and the
  sentinel falls through into the same code path as a real governorate.

An explicit 28-row lookup table costs nothing, fails loudly on an unrecognised input,
and survives Meta renaming a region. Derivation fails silently and splits one
governorate across two buckets. Use the table.

## 5. `Unknown` is a first-class bucket

**Decision: `Unknown` is an explicit canonical bucket (`EG-UNKNOWN`). It is never
dropped, never hidden, and never folded into a governorate.**

Meta emits `Unknown` when it cannot place the impression. That is real delivered
spend. Three ways of mishandling it, all rejected:

- **Dropping it** makes the governorate shares sum to 100% of a number that is not the
  account total, silently overstating every named governorate.
- **Folding it into Cairo** (or any "biggest region" heuristic) invents delivery that
  did not provably happen there — and Cairo is exactly where that error is least
  visible and most consequential.
- **Distributing it pro-rata** across named governorates is the same invention in a
  statistical costume: it manufactures precision out of an absence of data.

`Unknown` is displayed as its own row with its own spend, and its **share of total
spend is itself the quality signal**: a large `Unknown` share means the geo read is
weak for that period and should be caveated harder.

## 6. Order-side aliases: many-to-one, and messy

Meta's 28 values are clean. **The order side will not be.** Order-side location
arrives as free text typed by a customer, picked from a merchant's own dropdown, or
written by a courier's system. The alias table must therefore be **many-to-one**: many
raw order-side strings collapsing onto one canonical code.

Alias classes that must be supported, all resolving to a single code:

- **English variants and spellings** — `Cairo`, `cairo`, `CAIRO`, `Kairo`,
  `Al Qahirah`.
- **Arabic** — `القاهرة`, `الجيزة`, `الإسكندرية`, including forms with and without the
  definite article `ال`, plus variant orthography (`أ`/`ا`/`إ`, `ة`/`ه`, `ى`/`ي`).
- **Transliteration variants** — `Qalyubia` / `Qaliubiya` / `Kaliobia`,
  `Monufia` / `Menoufia` / `Menofia`, `Asyut` / `Assiut` / `Assiout`,
  `Faiyum` / `Fayoum` / `Al Fayyum`. There is no single accepted romanization of
  Egyptian place names; expect several per governorate.
- **District, city, and neighbourhood names** that are not governorates at all but are
  what customers actually type — `Nasr City`, `Maadi`, `Heliopolis`, `New Cairo`,
  `Zamalek` → `EG-C`; `6th of October`, `Sheikh Zayed`, `Dokki`, `Mohandessin` →
  `EG-GZ`; `Mansoura` → `EG-DK`; `Zagazig` → `EG-SHR`; `Tanta` → `EG-GH`;
  `Hurghada` → `EG-BA`; `Sharm El Sheikh` → `EG-JS`.

The district class is the largest and the one that decides whether the join is useful
at all — in practice a large share of Egyptian orders name a district rather than a
governorate.

**Governance:** the alias table is data, versioned in the repo, reviewed like code.
Adding an alias is a routine change and never triggers a rewrite of stored Meta rows,
because normalization happens on read (§3).

## 7. `UNMAPPED` and `MISSING` are surfaced, never silently absorbed

Two distinct order-side failure states, kept **separate from each other and separate
from Meta's `EG-UNKNOWN`**:

| Bucket | Meaning | Side | Fix |
|---|---|---|---|
| `EG-UNKNOWN` | Meta could not place the **impression**. | Delivery | None — Meta's limitation. |
| `UNMAPPED` | An order-side location string **was present** but matched no alias. | Order | Add the alias. |
| `MISSING` | The order record **had no location value at all**. | Order | Fix the source / checkout field. |

**Decision: both `UNMAPPED` and `MISSING` are surfaced explicitly — as visible rows
with counts and revenue. Never dropped, never merged into `EG-UNKNOWN`, never merged
into each other.**

They are different problems with different owners. `UNMAPPED` is our own data-quality
debt, fixable in an afternoon; a rising `UNMAPPED` list is a work queue naming exactly
which strings to add. `MISSING` is an upstream collection problem that no alias will
ever solve. Collapsing the two destroys the only signal that says which action to
take, and hiding either one makes the mapping look finished when it is not.

Any location view must therefore be able to state plainly: *of N orders, X mapped to a
governorate, Y were UNMAPPED, Z were MISSING.* A view that cannot answer that is not
shippable.

## 8. Joined metrics are blended and directional, never exact attribution

**Decision: any metric that joins Meta REGION delivery to order-side revenue must be
labelled blended / directional in the UI and in every export. It must never be
presented as attributed ROAS, attributed CPA, or attributed revenue.**

The join is a **spatial co-occurrence of two independently measured things**, not a
causal link between an impression and an order. Each of the following breaks the
attribution claim, and they compound:

- **No shared identity.** Meta reports where an *ad was delivered*; the order reports
  where a *parcel ships*. No row on either side is linked to a row on the other.
  Delivery location and shipping address are not the same fact and routinely differ —
  people order to work, to family, to a pickup point, while travelling.
- **`EG-UNKNOWN` on the Meta side** is unallocated spend that belongs to the campaign
  but to no governorate.
- **`UNMAPPED` and `MISSING` on the order side** are revenue that exists but has no
  governorate. Both denominators are incomplete, in different directions.
- **District-level aliasing is lossy.** An order naming a district inherits its
  governorate by table lookup, and every ambiguous district is a judgement call.
- **No time alignment.** Delivery day and purchase day are different days; a
  governorate's spend and its revenue over the same window describe different cohorts.
- **Cross-channel contamination.** Order-side revenue includes organic, direct,
  referral, and other paid channels. Meta spend explains only part of it.

**Permitted framing:** "governorates where spend is concentrated versus where revenue
is concentrated" — a *comparison of two distributions*, useful for spotting a
governorate absorbing heavy spend against thin revenue, and worth a human look.

**Prohibited framing:** any per-governorate ROAS, CPA, or revenue figure presented as
attributed truth, and any automated budget action driven by it. This data starts a
conversation; it does not end one.

## 9. Not decided here / out of scope

Recorded so the boundary is explicit. This document sets direction only; nothing below
is built, and no file under `src/` was changed to record it:

- The alias table itself, its storage, and its lookup implementation.
- Order-side location capture (`ClientOrder`, Shopify, custom API, CSV import).
- Any heatmap, map, or location UI.
- Wiring REGION into the `sync-all` full cadence — REGION remains **manual route only**,
  per the L1 scope.
- Countries other than Egypt. The ISO 3166-2 approach generalises; this table does not.

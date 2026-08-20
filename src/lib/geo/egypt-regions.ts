/**
 * Egypt governorates - canonical ISO 3166-2:EG lookup table.
 *
 * Implements the decision recorded in
 * `docs/location-intelligence-egypt-regions.md` section 3: the canonical key
 * for an Egyptian governorate is its ISO 3166-2:EG code. Meta's display strings
 * map INTO this key; order-side strings map INTO the same key; the join happens
 * on the code, never on a display string.
 *
 * Per section 4 this is an explicit lookup table and MUST NOT be replaced with
 * string manipulation. The codes are not derivable from the English names by
 * any rule (`EG-BA` for Red Sea, `EG-KB` for Qalyubia, `EG-JS` for South Sinai,
 * `EG-WAD` for New Valley) - they derive from the Arabic names.
 *
 * Scope note: this module is consumed by the order side today. The Meta REGION
 * read-side normalizer is a separate, later concern - `metaRegionValue` is
 * recorded here so both sides resolve to one table when that lands, but nothing
 * in `src/lib/meta/` imports this file yet and no stored Meta row is rewritten.
 */

/** ISO 3166-2:EG subdivision code, e.g. `EG-C`. */
export type EgyptRegionCode = string;

export interface EgyptRegion {
  /** Canonical ISO 3166-2:EG code, e.g. `EG-C`. */
  code: EgyptRegionCode;
  /** Canonical English display name, e.g. `Cairo`. */
  name: string;
  /**
   * Meta's `region` breakdown display string, per the section 3.1 table.
   * Recorded for the future Meta read-side normalizer; unused by the order
   * adapter.
   */
  metaRegionValue: string;
}

/**
 * The 27 Egyptian governorates. Ordered as in section 3.1 of the decision
 * record (descending by observed Meta delivery), not alphabetically.
 */
export const EGYPT_REGIONS: readonly EgyptRegion[] = [
  { code: "EG-C", name: "Cairo", metaRegionValue: "Cairo Governorate" },
  { code: "EG-GZ", name: "Giza", metaRegionValue: "Giza Governorate" },
  { code: "EG-ALX", name: "Alexandria", metaRegionValue: "Alexandria Governorate" },
  { code: "EG-KB", name: "Qalyubia", metaRegionValue: "Qalyubia Governorate" },
  { code: "EG-DK", name: "Dakahlia", metaRegionValue: "Dakahlia Governorate" },
  { code: "EG-SHR", name: "Sharqia", metaRegionValue: "Al Sharqia Governorate" },
  { code: "EG-GH", name: "Gharbia", metaRegionValue: "Gharbia Governorate" },
  { code: "EG-BH", name: "Beheira", metaRegionValue: "Beheira Governorate" },
  { code: "EG-MNF", name: "Monufia", metaRegionValue: "Monufia Governorate" },
  { code: "EG-DT", name: "Damietta", metaRegionValue: "Damietta Governorate" },
  { code: "EG-KFS", name: "Kafr el-Sheikh", metaRegionValue: "Kafr el-Sheikh Governorate" },
  { code: "EG-BA", name: "Red Sea", metaRegionValue: "Red Sea Governorate" },
  { code: "EG-IS", name: "Ismailia", metaRegionValue: "Ismailia Governorate" },
  { code: "EG-MN", name: "Minya", metaRegionValue: "Minya Governorate" },
  { code: "EG-SUZ", name: "Suez", metaRegionValue: "Suez Governorate" },
  { code: "EG-SHG", name: "Sohag", metaRegionValue: "Sohag Governorate" },
  { code: "EG-FYM", name: "Faiyum", metaRegionValue: "Faiyum Governorate" },
  { code: "EG-BNS", name: "Beni Suef", metaRegionValue: "Beni Suef Governorate" },
  { code: "EG-PTS", name: "Port Said", metaRegionValue: "Port Said Governorate" },
  { code: "EG-AST", name: "Asyut", metaRegionValue: "Asyut Governorate" },
  { code: "EG-JS", name: "South Sinai", metaRegionValue: "South Sinai Governorate" },
  { code: "EG-MT", name: "Matrouh", metaRegionValue: "Matrouh Governorate" },
  { code: "EG-KN", name: "Qena", metaRegionValue: "Qena Governorate" },
  { code: "EG-LX", name: "Luxor", metaRegionValue: "Luxor Governorate" },
  { code: "EG-ASN", name: "Aswan", metaRegionValue: "Aswan Governorate" },
  { code: "EG-WAD", name: "New Valley", metaRegionValue: "New Valley Governorate" },
  { code: "EG-SIN", name: "North Sinai", metaRegionValue: "North Sinai Governorate" },
];

/** ISO 3166-1 alpha-2 country code for Egypt. */
export const EGYPT_COUNTRY_CODE = "EG";

const BY_CODE = new Map<string, EgyptRegion>(
  EGYPT_REGIONS.map((region) => [region.code, region]),
);

/** Canonical name lookup, casefolded. Exact names only - no aliasing here. */
const BY_NAME = new Map<string, EgyptRegion>(
  EGYPT_REGIONS.map((region) => [region.name.toLowerCase(), region]),
);

/**
 * Region resolution sentinels, per sections 5 and 7 of the decision record.
 * These are first-class buckets, never dropped and never folded into a
 * governorate.
 */
export const REGION_MISSING = "MISSING";
export const REGION_UNMAPPED = "UNMAPPED";

/** How a region code was resolved. Distinguishes the section 7 failure states. */
export type RegionResolutionStatus =
  /** Resolved to a governorate from the Shopify province CODE (`EG` + `C`). */
  | "MAPPED_FROM_CODE"
  /** Resolved from the province display NAME after the code failed. */
  | "MAPPED_FROM_NAME"
  /** A location string was present but matched no governorate. Fix: add an alias. */
  | "UNMAPPED"
  /** No location value at all. Fix: the source / checkout field. */
  | "MISSING"
  /** Non-Egypt order. No table exists - deliberately NOT `UNMAPPED`. */
  | "OUT_OF_SCOPE";

export interface RegionResolution {
  /**
   * Canonical code (`EG-C`), a sentinel (`UNMAPPED` / `MISSING`), or null for
   * non-Egypt orders where no table applies.
   */
  code: string | null;
  status: RegionResolutionStatus;
  /** Canonical English name when mapped, otherwise null. */
  name: string | null;
}

/** Look up a governorate by canonical code. */
export function findRegionByCode(code: string): EgyptRegion | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

/**
 * Resolve an order's shipping location to a canonical governorate code.
 *
 * Precedence, per the L2-A plan:
 *   1. Country + province CODE - Shopify emits the ISO 3166-2:EG subdivision
 *      code without its prefix (`C` for Cairo), so `EG` + `C` composes directly
 *      into `EG-C` with no string matching and no transliteration risk. This is
 *      the preferred path.
 *   2. Province NAME - exact canonical-name match only, as a fallback when the
 *      code is blank.
 *   3. Otherwise `UNMAPPED` (something was present) or `MISSING` (nothing was).
 *
 * City is deliberately NOT used to infer a governorate here. District-level
 * aliasing (section 6) is a many-to-one table that does not exist yet; guessing
 * an Arabic district name onto `EG-C` without it would be exactly the silent
 * invention section 7 forbids. City presence only decides UNMAPPED vs MISSING.
 *
 * Non-Egypt orders return `OUT_OF_SCOPE` with a null code - conflating them
 * with `UNMAPPED` would poison the alias work queue with rows no alias can fix.
 */
export function resolveEgyptRegion(input: {
  countryCode: string | null;
  provinceCode: string | null;
  provinceName: string | null;
  city: string | null;
}): RegionResolution {
  const country = (input.countryCode ?? "").trim().toUpperCase();
  const provinceCode = (input.provinceCode ?? "").trim().toUpperCase();
  const provinceName = (input.provinceName ?? "").trim();
  const city = (input.city ?? "").trim();

  if (country && country !== EGYPT_COUNTRY_CODE) {
    return { code: null, status: "OUT_OF_SCOPE", name: null };
  }

  // Country is required to compose the key; without it we cannot even claim
  // the order is Egyptian, so it falls through to the sentinel branches below.
  if (provinceCode && country === EGYPT_COUNTRY_CODE) {
    const region = findRegionByCode(`${country}-${provinceCode}`);
    if (region) {
      return { code: region.code, status: "MAPPED_FROM_CODE", name: region.name };
    }
  }

  if (provinceName) {
    const region = BY_NAME.get(provinceName.toLowerCase());
    if (region) {
      return { code: region.code, status: "MAPPED_FROM_NAME", name: region.name };
    }
  }

  // Something was present but nothing matched - our own data-quality debt.
  if (provinceCode || provinceName || city) {
    return { code: REGION_UNMAPPED, status: "UNMAPPED", name: null };
  }

  // Nothing to work with - an upstream collection problem.
  return { code: REGION_MISSING, status: "MISSING", name: null };
}

/**
 * probe-meta-breakdowns.ts
 *
 * Read-only probe that asks Meta which breakdown dimensions our API version
 * accepts, and — more importantly — which of them return BUYER-USEFUL data
 * (purchases and conversion value), not merely spend/impressions. It exists to
 * inform scoping of any future schema / sync / UI work on breakdowns. It
 * decides nothing and changes nothing.
 *
 * This script ONLY reports. Specifically:
 *   - READ-ONLY Meta GET calls only, via the existing client method
 *     `getAccountInsightsWithBreakdown`. ZERO Meta mutations.
 *   - ZERO database writes (no create/update/delete/upsert/createMany/...).
 *     The only database access is a read to resolve each connection's name.
 *   - It never calls any sync function (syncStructural / syncInsights* /
 *     fetchInsightsForEntities / runJob / persistInsight /
 *     syncPublisherPlatformBreakdown) and never creates SyncJob rows.
 *   - It reuses the EXISTING client construction path (getMetaClient). It never
 *     reimplements auth/token handling, never reads or decrypts
 *     accessTokenEnc / refreshTokenEnc / appSecretEnc, and never logs any
 *     token, secret, or CRON_SECRET.
 *   - Calls are strictly sequential — no Promise.all anywhere.
 *
 * QUOTA WARNING: this consumes Meta API quota and counts against each
 * account's rate limit — roughly 10 breakdowns x 2 accounts = ~20 paginated
 * calls per run. Use it sparingly and manually; it is deliberately NOT wired to
 * any route, cron job, or package.json script.
 *
 * TYPE ASSERTION NOTE: `getAccountInsightsWithBreakdown`'s `breakdown`
 * parameter is typed as the literal union `MetaBreakdown`
 * ("publisher_platform" only), but the value is passed straight through to
 * Meta as a query-string parameter, so any breakdown string works at runtime.
 * This script therefore uses a single narrowly-scoped assertion at the call
 * site. Widening the production `MetaBreakdown` union in
 * `src/lib/meta/client.ts` is DELIBERATELY DEFERRED until these probe results
 * are known; `client.ts` is not modified by this script.
 *
 * Output: console summary plus CSV files under `diagnostics/`. That directory
 * is disposable throwaway diagnostic output and should be gitignored if it is
 * not already.
 *
 * Usage:
 *   DAYS=14 npx tsx scripts/probe-meta-breakdowns.ts
 *
 * Env:
 *   DAYS            window length in days (positive integer, default 14)
 *   CONNECTION_IDS  optional comma-separated connection ids overriding the
 *                   hardcoded live connections below
 *
 * Exit codes:
 *   0 — the probe completed
 *   1 — invalid env, no resolvable connection, or an unhandled error
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format, subDays } from "date-fns";
import { db } from "@/lib/db";
import { getMetaClient } from "@/lib/meta/sync";
import type { MetaBreakdown, MetaBreakdownInsight } from "@/lib/meta/client";

/**
 * The two live connections. Override with CONNECTION_IDS=a,b if needed.
 */
const DEFAULT_CONNECTION_IDS = [
  "cmq14bosi0005rdsj90qztjeg", // Mach
  "cmq850izp0005so6xqd9k3tc7", // ilvanto
];

/**
 * Breakdowns to probe, in order. A comma-separated entry is a COMBINED
 * breakdown (Meta returns one key per dimension on each row).
 */
const BREAKDOWNS = [
  "platform_position",
  "publisher_platform,platform_position",
  "country",
  "region",
  "age",
  "age,gender",
  "gender",
  "impression_device",
  "device_platform",
  "hourly_stats_aggregated_by_advertiser_time_zone",
];

/** Extra margin on top of the client's built-in 150ms inter-call spacing. */
const INTER_CALL_DELAY_MS = 1000;

type Verdict = "USEFUL" | "SPEND-ONLY" | "THIN" | "EMPTY";

interface ValueAggregate {
  value: string;
  spend: number;
  purchases: number;
  conversionValue: number;
  impressions: number;
}

interface ProbeResult {
  account: string;
  breakdown: string;
  success: boolean;
  error?: string;
  rowCount: number;
  keysDetected: string[];
  dimensionType: "single" | "combined" | "none";
  schemaFits: boolean;
  schemaNote: string;
  values: ValueAggregate[];
  totalSpend: number;
  totalPurchases: number;
  totalConversionValue: number;
  distinctValues: number;
  hasPurchases: boolean;
  hasConversionValue: boolean;
  verdict: Verdict;
}

/**
 * Deliberate local copy of `actionTotal` from `src/lib/meta/sync-breakdowns.ts`
 * (itself a deliberate copy of the unexported helper in `src/lib/meta/sync.ts`).
 * Copying matches the existing convention in this codebase and keeps this task
 * from modifying production files. Keep them in sync manually.
 *
 * Total for a Meta action stat. Uses the top-level `value` when it parses to a
 * finite number; otherwise falls back to summing the attribution-window fields
 * (`7d_click` + `1d_view`), which is all Meta returns when conversions are
 * entirely window-attributed. Never returns NaN.
 */
function actionTotal(
  action:
    | { value?: string; "7d_click"?: string; "1d_view"?: string }
    | null
    | undefined,
): number {
  if (!action) return 0;
  const direct = Number(action.value);
  if (Number.isFinite(direct)) return direct;
  let sum = 0;
  let found = false;
  for (const v of [action["7d_click"], action["1d_view"]]) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      sum += n;
      found = true;
    }
  }
  return found ? sum : 0;
}

/** Parses a Meta numeric string, returning 0 for missing / non-finite values. */
function numberOrZero(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(csvCell).join(",");
}

function money(n: number): string {
  return n.toFixed(2);
}

function analyse(
  account: string,
  breakdown: string,
  rows: MetaBreakdownInsight[],
): ProbeResult {
  const requestedKeys = breakdown.split(",").map((k) => k.trim());

  // `MetaBreakdownInsight` only declares `publisher_platform?`, so read
  // arbitrary breakdown keys through a Record cast.
  const first = rows[0] as unknown as Record<string, unknown> | undefined;
  const keysDetected = first
    ? requestedKeys.filter((k) => first[k] !== undefined)
    : [];

  const dimensionType =
    keysDetected.length === 0
      ? "none"
      : keysDetected.length === 1
        ? "single"
        : "combined";

  const schemaFits = dimensionType === "single";
  const schemaNote = schemaFits
    ? "Fits the existing InsightsBreakdownDaily unique key (one dimension + one value per row)."
    : dimensionType === "combined"
      ? "Combined dimensions do NOT fit today's one-dimension-per-row unique key; would need a composite value strategy or an additive schema change."
      : "No breakdown keys present on the returned rows.";

  const byValue = new Map<string, ValueAggregate>();

  for (const row of rows) {
    const record = row as unknown as Record<string, unknown>;
    const value =
      keysDetected.length > 0
        ? keysDetected.map((k) => String(record[k] ?? "unknown")).join("|")
        : "unknown";

    const purchases = actionTotal(
      row.actions?.find((a) => a.action_type === "purchase"),
    );
    const conversionValue = actionTotal(
      row.action_values?.find((a) => a.action_type === "purchase"),
    );

    const agg = byValue.get(value) ?? {
      value,
      spend: 0,
      purchases: 0,
      conversionValue: 0,
      impressions: 0,
    };
    agg.spend += numberOrZero(row.spend);
    agg.purchases += purchases;
    agg.conversionValue += conversionValue;
    agg.impressions += numberOrZero(row.impressions);
    byValue.set(value, agg);
  }

  const values = [...byValue.values()];
  const totalSpend = values.reduce((s, v) => s + v.spend, 0);
  const totalPurchases = values.reduce((s, v) => s + v.purchases, 0);
  const totalConversionValue = values.reduce(
    (s, v) => s + v.conversionValue,
    0,
  );
  const distinctValues = values.length;
  const hasPurchases = totalPurchases > 0;
  const hasConversionValue = totalConversionValue > 0;

  let verdict: Verdict;
  if (rows.length === 0) {
    verdict = "EMPTY";
  } else if (distinctValues <= 1) {
    verdict = "THIN";
  } else if (hasPurchases && hasConversionValue) {
    verdict = "USEFUL";
  } else if (totalSpend > 0) {
    verdict = "SPEND-ONLY";
  } else {
    verdict = "EMPTY";
  }

  return {
    account,
    breakdown,
    success: true,
    rowCount: rows.length,
    keysDetected,
    dimensionType,
    schemaFits,
    schemaNote,
    values,
    totalSpend,
    totalPurchases,
    totalConversionValue,
    distinctValues,
    hasPurchases,
    hasConversionValue,
    verdict,
  };
}

function failure(
  account: string,
  breakdown: string,
  error: string,
): ProbeResult {
  return {
    account,
    breakdown,
    success: false,
    error,
    rowCount: 0,
    keysDetected: [],
    dimensionType: "none",
    schemaFits: false,
    schemaNote: "Not evaluated — the breakdown was rejected by Meta.",
    values: [],
    totalSpend: 0,
    totalPurchases: 0,
    totalConversionValue: 0,
    distinctValues: 0,
    hasPurchases: false,
    hasConversionValue: false,
    verdict: "EMPTY",
  };
}

function printResult(result: ProbeResult) {
  console.log(`\n  --- ${result.breakdown} ---`);

  if (!result.success) {
    console.log(`  REJECTED: ${result.error}`);
    return;
  }

  console.log(
    `  rows=${result.rowCount}  distinctValues=${result.distinctValues}  keys=[${result.keysDetected.join(", ") || "none"}] (${result.dimensionType})`,
  );
  console.log(`  schemaFits=${result.schemaFits} — ${result.schemaNote}`);
  console.log(
    `  spend=${money(result.totalSpend)}  purchases=${result.totalPurchases}  conversionValue=${money(result.totalConversionValue)}`,
  );
  console.log(
    `  hasPurchases=${result.hasPurchases}  hasConversionValue=${result.hasConversionValue}  VERDICT=${result.verdict}`,
  );

  const topSpend = [...result.values]
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);
  const topPurchases = [...result.values]
    .sort((a, b) => b.purchases - a.purchases)
    .slice(0, 5);

  if (topSpend.length > 0) {
    console.log("  top 5 by spend:");
    for (const v of topSpend) {
      console.log(
        `    ${v.value} — spend=${money(v.spend)} purchases=${v.purchases} value=${money(v.conversionValue)} impressions=${v.impressions}`,
      );
    }
    console.log("  top 5 by purchases:");
    for (const v of topPurchases) {
      console.log(
        `    ${v.value} — purchases=${v.purchases} value=${money(v.conversionValue)} spend=${money(v.spend)}`,
      );
    }
  }
}

const VERDICT_RANK: Record<Verdict, number> = {
  USEFUL: 0,
  "SPEND-ONLY": 1,
  THIN: 2,
  EMPTY: 3,
};

function printSummary(results: ProbeResult[]) {
  console.log(`\n${"=".repeat(100)}`);
  console.log("OVERALL SUMMARY (ranked by verdict)");
  console.log("=".repeat(100));

  const header = [
    "ACCOUNT".padEnd(16),
    "BREAKDOWN".padEnd(48),
    "VERDICT".padEnd(12),
    "FITS".padEnd(6),
    "VALUES".padStart(7),
    "PURCH".padStart(8),
    "CONV.VALUE".padStart(12),
  ].join(" ");
  console.log(header);
  console.log("-".repeat(100));

  const sorted = [...results].sort((a, b) => {
    const byOk = Number(a.success) - Number(b.success);
    if (byOk !== 0) return -byOk;
    const byVerdict = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict];
    if (byVerdict !== 0) return byVerdict;
    return b.totalConversionValue - a.totalConversionValue;
  });

  for (const r of sorted) {
    console.log(
      [
        r.account.slice(0, 16).padEnd(16),
        r.breakdown.slice(0, 48).padEnd(48),
        (r.success ? r.verdict : "REJECTED").padEnd(12),
        String(r.success ? r.schemaFits : "-").padEnd(6),
        String(r.distinctValues).padStart(7),
        String(r.totalPurchases).padStart(8),
        money(r.totalConversionValue).padStart(12),
      ].join(" "),
    );
  }
  console.log("-".repeat(100));
}

function writeCsvFiles(results: ProbeResult[], since: string, until: string) {
  const dir = path.join(process.cwd(), "diagnostics");
  mkdirSync(dir, { recursive: true });

  const stamp = format(new Date(), "yyyy-MM-dd-HHmm");

  const detailLines = [
    csvRow([
      "account",
      "breakdown",
      "dimensionType",
      "schemaFits",
      "value",
      "spend",
      "purchases",
      "conversionValue",
      "impressions",
    ]),
  ];

  for (const r of results) {
    for (const v of r.values) {
      detailLines.push(
        csvRow([
          r.account,
          r.breakdown,
          r.dimensionType,
          String(r.schemaFits),
          v.value,
          money(v.spend),
          v.purchases,
          money(v.conversionValue),
          v.impressions,
        ]),
      );
    }
  }

  const detailPath = path.join(dir, `breakdown-probe-${stamp}.csv`);
  writeFileSync(detailPath, `${detailLines.join("\n")}\n`, "utf8");

  const summaryLines = [
    csvRow([
      "account",
      "breakdown",
      "success",
      "error",
      "dimensionType",
      "keysDetected",
      "schemaFits",
      "rowCount",
      "distinctValues",
      "totalSpend",
      "totalPurchases",
      "totalConversionValue",
      "hasPurchases",
      "hasConversionValue",
      "verdict",
      "since",
      "until",
    ]),
  ];

  for (const r of results) {
    summaryLines.push(
      csvRow([
        r.account,
        r.breakdown,
        String(r.success),
        r.error ?? "",
        r.dimensionType,
        r.keysDetected.join("|"),
        String(r.schemaFits),
        r.rowCount,
        r.distinctValues,
        money(r.totalSpend),
        r.totalPurchases,
        money(r.totalConversionValue),
        String(r.hasPurchases),
        String(r.hasConversionValue),
        r.success ? r.verdict : "REJECTED",
        since,
        until,
      ]),
    );
  }

  const summaryPath = path.join(dir, `breakdown-probe-${stamp}-summary.csv`);
  writeFileSync(summaryPath, `${summaryLines.join("\n")}\n`, "utf8");

  console.log(`\nCSV written:\n  ${detailPath}\n  ${summaryPath}`);
}

async function main() {
  const rawDays = process.env.DAYS?.trim();
  const days = rawDays ? Number(rawDays) : 14;
  if (!Number.isInteger(days) || days <= 0) {
    console.error("ERROR: DAYS must be a positive integer.");
    process.exit(1);
  }

  const connectionIds = (
    process.env.CONNECTION_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? DEFAULT_CONNECTION_IDS
  ).filter(Boolean);

  if (connectionIds.length === 0) {
    console.error("ERROR: no connection ids to probe.");
    process.exit(1);
  }

  const today = new Date();
  const until = format(today, "yyyy-MM-dd");
  const since = format(subDays(today, days - 1), "yyyy-MM-dd");

  console.log(
    `Meta breakdown probe (READ-ONLY) — window ${since} → ${until} (${days} days)`,
  );
  console.log(
    `Probing ${BREAKDOWNS.length} breakdowns x ${connectionIds.length} accounts, sequentially.`,
  );

  const results: ProbeResult[] = [];
  let resolved = 0;

  for (const connectionId of connectionIds) {
    const connection = await db.adAccountConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, accountName: true },
    });

    if (!connection) {
      console.error(`\nConnection ${connectionId} not found — skipping.`);
      continue;
    }

    // Existing helper: enforces ACTIVE status + stored token, decrypts the
    // token and picks the profile's API version. Never reimplemented here.
    const ctx = await getMetaClient(connectionId);
    if (!ctx) {
      console.error(
        `\n${connection.accountName}: Meta client unavailable (inactive or missing stored token) — skipping.`,
      );
      continue;
    }

    resolved += 1;
    console.log(`\n${"=".repeat(100)}`);
    console.log(`ACCOUNT: ${connection.accountName} (${connectionId})`);
    console.log("=".repeat(100));

    for (const breakdown of BREAKDOWNS) {
      console.log(`\n[${connection.accountName}] probing "${breakdown}"...`);

      try {
        const rows = await ctx.meta.getAccountInsightsWithBreakdown(
          ctx.platformAccountId,
          // Intentional, narrowly-scoped assertion: `MetaBreakdown` is
          // deliberately narrow in production, but the value is forwarded to
          // Meta as a plain query-string param, so any breakdown string works
          // at runtime. Widening the union is deferred until this probe's
          // results are known — see the header comment.
          breakdown as MetaBreakdown,
          since,
          until,
        );
        const result = analyse(connection.accountName, breakdown, rows);
        results.push(result);
        printResult(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Meta breakdown fetch failed.";
        const result = failure(connection.accountName, breakdown, message);
        results.push(result);
        printResult(result);
      }

      // Extra margin over the client's own 150ms inter-call spacing.
      await sleep(INTER_CALL_DELAY_MS);
    }
  }

  if (resolved === 0) {
    console.error("\nNo connections could be probed.");
    process.exit(1);
  }

  printSummary(results);
  writeCsvFiles(results, since, until);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());

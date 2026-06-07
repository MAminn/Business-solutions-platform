/**
 * diagnose-mach-insights.ts
 *
 * READ-ONLY diagnostic. Probes which Meta /insights request shapes currently
 * succeed or fail for ONE ad account, to determine whether the repeated
 * code 2 / subcode 1504044 failures correlate with request size/level
 * (→ heaviness, points to chunking) or fail uniformly regardless of size
 * (→ a true Meta transient / account-specific block).
 *
 * This script ONLY reports. It does NOT:
 *   - write to the database (no create/update/delete/upsert, no SyncJob rows)
 *   - run any sync function (syncStructural / syncInsights* / runJob /
 *     fetchInsightsForEntities)
 *   - add/modify/reimplement any Meta client method, auth, or token logic
 *   - decrypt or log tokens or secrets
 *
 * It reuses the EXISTING client construction path (getMetaClient) and the
 * EXISTING client methods (getInsightsDaily, getAccountInsightsByLevel).
 * Safe to run repeatedly with no side effects.
 *
 * Usage:
 *   ACCOUNT_ID="act_2106505896497404" tsx scripts/diagnose-mach-insights.ts
 *
 * Exit codes:
 *   0 — the run completed (regardless of individual probe outcomes)
 *   1 — ACCOUNT_ID missing, or the connection could not be resolved
 */
import { format, subDays } from "date-fns";
import { db } from "@/lib/db";
import { getMetaClient } from "@/lib/meta/sync";

// Reuse the same date helper/format the existing client methods expect.
function windowDates(days: number): { since: string; until: string } {
  const today = new Date();
  return {
    since: format(subDays(today, days - 1), "yyyy-MM-dd"),
    until: format(today, "yyyy-MM-dd"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "Size" ordering so we can report the largest success and smallest failure.
// Higher weight = heavier request. Level breakdowns are heavier than the
// single account row; longer windows are heavier than shorter ones.
type Level = "account" | "campaign" | "ad";
const LEVEL_WEIGHT: Record<Level, number> = {
  account: 0,
  campaign: 100,
  ad: 200,
};

interface ProbeResult {
  label: string;
  level: Level;
  days: number;
  weight: number;
  ok: boolean;
  rows?: number;
  code?: number | string;
  subcode?: number | string;
  message?: string;
}

function extractMetaError(err: unknown): {
  code?: number | string;
  subcode?: number | string;
  message: string;
} {
  // The existing client surfaces code/subcode on MetaRateLimitError
  // (metaCode/metaSubcode) and MetaApiError (metaCode/metaSubcode). Read them
  // defensively without importing or reimplementing those types.
  const anyErr = err as {
    metaCode?: number;
    metaSubcode?: number;
    message?: string;
  } | null;
  const message =
    err instanceof Error ? err.message : String(err ?? "Unknown error");
  return {
    code: anyErr?.metaCode,
    subcode: anyErr?.metaSubcode,
    message,
  };
}

type MetaClientCtx = NonNullable<Awaited<ReturnType<typeof getMetaClient>>>;
type MetaClientInstance = MetaClientCtx["meta"];

async function runProbe(
  meta: MetaClientInstance,
  platformAccountId: string,
  level: Level,
  days: number,
): Promise<ProbeResult> {
  const label = `${level}-level — last ${days} day${days === 1 ? "" : "s"}`;
  const weight = LEVEL_WEIGHT[level] + days;
  const { since, until } = windowDates(days);

  try {
    let rows: number;
    if (level === "account") {
      const data = await meta.getInsightsDaily(platformAccountId, since, until);
      rows = data.length;
    } else {
      const data = await meta.getAccountInsightsByLevel(
        platformAccountId,
        level,
        since,
        until,
      );
      rows = data.length;
    }
    return { label, level, days, weight, ok: true, rows };
  } catch (err) {
    const { code, subcode, message } = extractMetaError(err);
    return { label, level, days, weight, ok: false, code, subcode, message };
  }
}

async function main(): Promise<void> {
  const accountId = process.env.ACCOUNT_ID?.trim();
  if (!accountId) {
    console.error(
      "ERROR: ACCOUNT_ID environment variable is required (the Meta platformAccountId, e.g. act_2106505896497404).",
    );
    process.exit(1);
  }

  // Resolve the connection (read-only) to obtain its internal id, then reuse
  // the existing getMetaClient construction path. No new client/auth flow.
  const conn = await db.adAccountConnection.findFirst({
    where: { platformAccountId: accountId },
    select: { id: true, accountName: true },
  });
  if (!conn) {
    console.error(
      `ERROR: No AdAccountConnection found with platformAccountId = "${accountId}".`,
    );
    process.exit(1);
  }

  const ctx = await getMetaClient(conn.id);
  if (!ctx) {
    console.error(
      `ERROR: Could not construct a Meta client for connection "${conn.id}" ` +
        "(connection inactive or missing OAuth token).",
    );
    process.exit(1);
  }

  const { meta, platformAccountId } = ctx;

  console.log("=".repeat(72));
  console.log("Meta /insights request-shape probe (READ-ONLY)");
  console.log("=".repeat(72));
  console.log(`accountName:        ${conn.accountName}`);
  console.log(`platformAccountId:  ${platformAccountId}`);
  console.log(`runAt:              ${new Date().toISOString()}`);
  console.log("");
  console.log("Probes (one /insights read each, ~2s apart):");
  console.log("-".repeat(72));

  // Ordered smallest → largest. Each probe is independent: one failure never
  // stops the rest. A ~2s gap between probes avoids rate-limit confounding.
  const plan: Array<{ level: Level; days: number }> = [
    { level: "account", days: 1 },
    { level: "account", days: 7 },
    { level: "account", days: 30 },
    { level: "campaign", days: 7 },
    { level: "campaign", days: 30 },
    { level: "ad", days: 7 },
    { level: "ad", days: 30 },
  ];

  const results: ProbeResult[] = [];
  for (let i = 0; i < plan.length; i++) {
    const { level, days } = plan[i];
    const result = await runProbe(meta, platformAccountId, level, days);
    results.push(result);

    if (result.ok) {
      console.log(`${result.label}: SUCCESS — rows=${result.rows}`);
    } else {
      console.log(
        `${result.label}: FAIL — code=${result.code ?? "?"} ` +
          `subcode=${result.subcode ?? "?"} message="${result.message ?? ""}"`,
      );
    }

    // ~2s pause between probes (not after the last one).
    if (i < plan.length - 1) {
      await sleep(2000);
    }
  }

  // --------------------------------------------------------------------------
  // Interpretation
  // --------------------------------------------------------------------------
  console.log("");
  console.log("=".repeat(72));
  console.log("INTERPRETATION");
  console.log("=".repeat(72));

  const successes = results.filter((r) => r.ok);
  const failures = results.filter((r) => !r.ok);

  const largestSuccess =
    successes.length > 0
      ? successes.reduce((a, b) => (b.weight > a.weight ? b : a))
      : null;
  const smallestFailure =
    failures.length > 0
      ? failures.reduce((a, b) => (b.weight < a.weight ? b : a))
      : null;

  console.log(
    `Largest window/level that SUCCEEDED: ${
      largestSuccess ? largestSuccess.label : "none"
    }`,
  );
  console.log(
    `Smallest window/level that FAILED:   ${
      smallestFailure ? smallestFailure.label : "none"
    }`,
  );
  console.log("");

  const accountOneDay = results.find(
    (r) => r.level === "account" && r.days === 1,
  );

  let inferred: string;
  if (failures.length === 0) {
    inferred =
      "all probes succeeded → no current size-related or transient failure for this account.";
  } else if (successes.length === 0) {
    inferred =
      "fails at every window including 1-day account-level → not size-related, " +
      "consistent with a true Meta transient or account-specific block.";
  } else if (accountOneDay && !accountOneDay.ok) {
    // Smallest possible request fails, yet something larger succeeded → not a
    // clean size gradient.
    inferred = "mixed/inconclusive → rerun.";
  } else if (
    largestSuccess &&
    smallestFailure &&
    smallestFailure.weight > largestSuccess.weight
  ) {
    inferred =
      "fails only at larger windows/levels → request heaviness, points to chunking the pull.";
  } else {
    inferred = "mixed/inconclusive → rerun.";
  }

  console.log(`Inferred pattern: ${inferred}`);
  console.log("");
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("");
    console.error("Script errored:");
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });

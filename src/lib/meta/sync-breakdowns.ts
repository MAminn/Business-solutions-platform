/**
 * Publisher-platform breakdown sync (Phase B — ACCOUNT level, kill-switched).
 *
 * Fetches Meta `publisher_platform` breakdown insights at ACCOUNT level for a
 * single connection over an N-day window and stores them in
 * `InsightsBreakdownDaily`. This is a completely separate write path from the
 * entity-level insights pipeline in `lib/meta/sync.ts`: it never touches
 * `InsightsDaily`, `persistInsight`, or any `SyncJob` row.
 *
 * Manual trigger only, disabled by default behind `BREAKDOWN_SYNC_ENABLED`.
 *
 * Secrets safety: token bytes are never logged or returned.
 */

import { format, subDays } from "date-fns";
import { BreakdownDimension, InsightEntity } from "@prisma/client";
import { db } from "@/lib/db";
import { getMetaClient } from "@/lib/meta/sync";
import type { MetaBreakdownInsight } from "@/lib/meta/client";

export type BreakdownSyncOutcome = "disabled" | "synced" | "failed";

export interface BreakdownReconciliation {
  /** Sum of InsightsBreakdownDaily.spend for this connection/dimension/window. */
  breakdownSpend: number;
  /** Sum of InsightsDaily.spend for entityType=ACCOUNT / this connection / same window. */
  entitySpend: number;
  /** breakdownSpend - entitySpend. */
  delta: number;
  /** delta as a percentage of entitySpend; null when entitySpend is 0. */
  deltaPct: number | null;
  /** Days in the requested window. */
  windowDays: number;
  /** Distinct in-window dates that have breakdown rows. */
  breakdownDaysPresent: number;
  /** Distinct in-window dates that have ACCOUNT-level InsightsDaily rows. */
  entityDaysPresent: number;
  /** Dates present on BOTH sides. */
  overlapDays: number;
  /** Breakdown spend summed over overlap days only. */
  overlapBreakdownSpend: number;
  /** Entity spend summed over overlap days only. */
  overlapEntitySpend: number;
  /** overlapBreakdownSpend - overlapEntitySpend. */
  overlapDelta: number;
  /**
   * The honest apples-to-apples comparison: overlapDelta as a percentage of
   * overlapEntitySpend. Null when overlapEntitySpend is 0.
   */
  overlapDeltaPct: number | null;
  /** True only when both sides cover the same days and all of them overlap. */
  coverageComplete: boolean;
  /** Names the day shortfall when coverage is incomplete; null when complete. */
  warning: string | null;
  note: string;
}

export interface BreakdownSyncResult {
  connectionId: string;
  accountName: string;
  outcome: BreakdownSyncOutcome;
  fetched: number;
  written: number;
  windowStart: string;
  windowEnd: string;
  reconciliation: BreakdownReconciliation | null;
  error?: string;
}

const RECONCILIATION_NOTE =
  "Read coverage before reading the delta. When coverageComplete is true, " +
  "both sides cover the same days and a SMALL delta is expected — Meta " +
  "cannot always attribute every row to a breakdown value. When " +
  "coverageComplete is false, the full-window delta is NOT meaningful: it " +
  "measures missing days on one side, not attribution variance — read " +
  "overlapDeltaPct instead, which compares only the days both sides have. " +
  "In all cases this data is a split for comparison, never a restatement of " +
  "account totals.";

/**
 * Deliberate local copy of `actionTotal` from `lib/meta/sync.ts` (it is not
 * exported there, and this task must not modify that file). Keep the two in
 * sync manually.
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

export async function syncPublisherPlatformBreakdown(
  connectionId: string,
  days = 30,
): Promise<BreakdownSyncResult> {
  const untilDate = format(new Date(), "yyyy-MM-dd");
  const sinceDate = format(subDays(new Date(), days - 1), "yyyy-MM-dd");

  const base: BreakdownSyncResult = {
    connectionId,
    accountName: "",
    outcome: "disabled",
    fetched: 0,
    written: 0,
    windowStart: sinceDate,
    windowEnd: untilDate,
    reconciliation: null,
  };

  // ---- Kill switch: zero Meta calls, zero writes --------------------------
  if (process.env.BREAKDOWN_SYNC_ENABLED !== "true") {
    return base;
  }

  const connection = await db.adAccountConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, accountName: true },
  });
  if (!connection) {
    return { ...base, outcome: "failed", error: "Connection not found." };
  }

  // `getMetaClient` is the existing helper: it enforces status === ACTIVE and a
  // stored token, decrypts the token, and selects the profile's API version.
  // Never reimplemented here.
  const ctx = await getMetaClient(connectionId);
  if (!ctx) {
    return {
      ...base,
      accountName: connection.accountName,
      outcome: "failed",
      error:
        "Connection is not available for sync (inactive or missing stored token).",
    };
  }

  let rows: MetaBreakdownInsight[];
  try {
    rows = await ctx.meta.getAccountInsightsWithBreakdown(
      ctx.platformAccountId,
      "publisher_platform",
      sinceDate,
      untilDate,
    );
  } catch (err) {
    return {
      ...base,
      accountName: connection.accountName,
      outcome: "failed",
      error: err instanceof Error ? err.message : "Meta insights fetch failed.",
    };
  }

  let written = 0;
  try {
    for (const row of rows) {
      const date = new Date(row.date_start);
      const value = row.publisher_platform ?? "unknown";

      const purchaseAction = row.actions?.find(
        (a) => a.action_type === "purchase",
      );
      const purchaseValueAction = row.action_values?.find(
        (a) => a.action_type === "purchase",
      );

      // FULL-ROW payload written on BOTH the create and update branches. This
      // is deliberate: a partial update is the stale-metric bug class present
      // in `persistInsight`'s update branch (where ctr/frequency/clicks are not
      // refreshed on re-pulls). Every re-sync fully restates the row.
      const data = {
        impressions: numberOrZero(row.impressions),
        clicks: numberOrZero(row.clicks),
        spend: numberOrZero(row.spend).toFixed(2),
        purchases: actionTotal(purchaseAction),
        conversionValue: actionTotal(purchaseValueAction).toFixed(2),
        raw: row as unknown as object,
      };

      await db.insightsBreakdownDaily.upsert({
        where: {
          entityType_entityId_date_dimension_value: {
            entityType: InsightEntity.ACCOUNT,
            entityId: connection.id,
            date,
            dimension: BreakdownDimension.PUBLISHER_PLATFORM,
            value,
          },
        },
        create: {
          entityType: InsightEntity.ACCOUNT,
          entityId: connection.id,
          date,
          dimension: BreakdownDimension.PUBLISHER_PLATFORM,
          value,
          ...data,
        },
        update: data,
      });
      written++;
    }
  } catch (err) {
    return {
      ...base,
      accountName: connection.accountName,
      outcome: "failed",
      fetched: rows.length,
      written,
      error: err instanceof Error ? err.message : "Breakdown write failed.",
    };
  }

  // ---- Reconciliation (read-only, never blocking) -------------------------
  // The write above has already succeeded. Everything below is reporting only:
  // it must never change `outcome`, never change `written`, and never throw.
  const success: BreakdownSyncResult = {
    connectionId: connection.id,
    accountName: connection.accountName,
    outcome: "synced",
    fetched: rows.length,
    written,
    windowStart: sinceDate,
    windowEnd: untilDate,
    reconciliation: null,
  };

  try {
    const windowStartDate = new Date(`${sinceDate}T00:00:00.000Z`);
    const windowEndDate = new Date(`${untilDate}T00:00:00.000Z`);

    // Per-day, not just totals. Comparing full-window sums without checking
    // that both sides cover the same days is what produced the phantom +103%
    // delta in the Phase B pilot: 30 days of breakdown data measured against
    // 17 days of entity data (an entity-side sync gap, since repaired). Group
    // by date so a coverage gap is reported as a coverage gap.
    const breakdownByDay = await db.insightsBreakdownDaily.groupBy({
      by: ["date"],
      where: {
        entityType: InsightEntity.ACCOUNT,
        entityId: connection.id,
        dimension: BreakdownDimension.PUBLISHER_PLATFORM,
        date: { gte: windowStartDate, lte: windowEndDate },
      },
      _sum: { spend: true },
    });
    const entityByDay = await db.insightsDaily.groupBy({
      by: ["date"],
      where: {
        entityType: InsightEntity.ACCOUNT,
        entityId: connection.id,
        date: { gte: windowStartDate, lte: windowEndDate },
      },
      _sum: { spend: true },
    });

    const isoDay = (d: Date) => d.toISOString().slice(0, 10);
    const breakdownDays = new Map(
      breakdownByDay.map((r) => [isoDay(r.date), Number(r._sum.spend ?? 0)]),
    );
    const entityDays = new Map(
      entityByDay.map((r) => [isoDay(r.date), Number(r._sum.spend ?? 0)]),
    );

    // Full-window totals, derived from the same grouped rows so the existing
    // fields keep their previous meaning.
    const sum = (values: Iterable<number>) => {
      let total = 0;
      for (const v of values) total += v;
      return total;
    };
    const breakdownSpend = sum(breakdownDays.values());
    const entitySpend = sum(entityDays.values());
    const delta = breakdownSpend - entitySpend;

    const overlap = [...breakdownDays.keys()].filter((d) => entityDays.has(d));
    const overlapBreakdownSpend = sum(
      overlap.map((d) => breakdownDays.get(d)!),
    );
    const overlapEntitySpend = sum(overlap.map((d) => entityDays.get(d)!));
    const overlapDelta = overlapBreakdownSpend - overlapEntitySpend;

    const breakdownDaysPresent = breakdownDays.size;
    const entityDaysPresent = entityDays.size;
    const overlapDays = overlap.length;
    const coverageComplete =
      breakdownDaysPresent === entityDaysPresent &&
      overlapDays === entityDaysPresent;

    const warning = coverageComplete
      ? null
      : `Coverage mismatch over the ${days}-day window: breakdown data covers ` +
        `${breakdownDaysPresent} of ${days} days, entity-level data covers ` +
        `${entityDaysPresent} of ${days} days, and only ${overlapDays} days ` +
        `are present on both sides. The full-window delta is dominated by the ` +
        `days missing from one side, not by attribution variance — compare ` +
        `overlapDeltaPct instead.`;

    return {
      ...success,
      reconciliation: {
        breakdownSpend,
        entitySpend,
        delta,
        deltaPct: entitySpend === 0 ? null : (delta / entitySpend) * 100,
        windowDays: days,
        breakdownDaysPresent,
        entityDaysPresent,
        overlapDays,
        overlapBreakdownSpend,
        overlapEntitySpend,
        overlapDelta,
        overlapDeltaPct:
          overlapEntitySpend === 0
            ? null
            : (overlapDelta / overlapEntitySpend) * 100,
        coverageComplete,
        warning,
        note: RECONCILIATION_NOTE,
      },
    };
  } catch (err) {
    // A reporting failure must never turn a successful sync into a failure.
    console.error(
      `[sync-breakdowns] reconciliation failed (non-fatal); write outcome unaffected connectionId=${connection.id} error=${err instanceof Error ? err.message : String(err)}`,
    );
    return success;
  }
}

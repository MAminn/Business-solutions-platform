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
  "Breakdown totals may not match entity-level totals exactly — Meta cannot " +
  "always attribute every row to a breakdown value. A mismatch is expected " +
  "and is NOT an error; this data is a split for comparison, never a " +
  "restatement of account totals.";

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
  const windowStartDate = new Date(`${sinceDate}T00:00:00.000Z`);
  const windowEndDate = new Date(`${untilDate}T00:00:00.000Z`);

  const breakdownAgg = await db.insightsBreakdownDaily.aggregate({
    where: {
      entityType: InsightEntity.ACCOUNT,
      entityId: connection.id,
      dimension: BreakdownDimension.PUBLISHER_PLATFORM,
      date: { gte: windowStartDate, lte: windowEndDate },
    },
    _sum: { spend: true },
  });
  const entityAgg = await db.insightsDaily.aggregate({
    where: {
      entityType: InsightEntity.ACCOUNT,
      entityId: connection.id,
      date: { gte: windowStartDate, lte: windowEndDate },
    },
    _sum: { spend: true },
  });

  const breakdownSpend = Number(breakdownAgg._sum.spend ?? 0);
  const entitySpend = Number(entityAgg._sum.spend ?? 0);
  const delta = breakdownSpend - entitySpend;

  return {
    connectionId: connection.id,
    accountName: connection.accountName,
    outcome: "synced",
    fetched: rows.length,
    written,
    windowStart: sinceDate,
    windowEnd: untilDate,
    reconciliation: {
      breakdownSpend,
      entitySpend,
      delta,
      deltaPct: entitySpend === 0 ? null : (delta / entitySpend) * 100,
      note: RECONCILIATION_NOTE,
    },
  };
}

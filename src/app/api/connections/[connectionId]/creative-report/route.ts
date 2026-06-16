import { subDays, format } from "date-fns";
import type { NextRequest } from "next/server";
import type { CreativeType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import {
  renderCreativeReportPdf,
  VERDICTS,
} from "@/server/creative-report-doc";
import type {
  CreativeReportData,
  CreativeReportRow,
  Verdict,
} from "@/server/creative-report-doc";

// ============================================================================
// Per-connection "Creative Analysis Report" PDF export.
//
// Aggregates already-synced ad-level InsightsDaily rows per creative over the
// last 30 days, derives a per-creative verdict, and renders a branded PDF via
// @react-pdf/renderer. Read-only: no Meta API calls, no writes.
//
// Mirrors the requireUser()/getAccessibleClientIds() access-control pattern
// and the insightsBackfilledAt hard-block used in the creative-bundle route.
// The read shape is replicated locally (no import from the bundle route).
//
// Revenue / ROAS / CPA are Meta-reported and not reconciled against real
// sales — the report states this explicitly.
// ============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

// Verdict thresholds (clearly named).
// A creative counts as "top spend-share" when it carries at least this
// fraction of the account's total 30-day spend.
const SCALE_MIN_SPEND_SHARE = 0.05;
// Minimum usable (stable) daily data points before a fatigue trend is called.
const FATIGUE_MIN_USABLE_DAYS = 4;
// Number of most-recent days dropped from the fatigue trend (see isFatigued).
const FATIGUE_STALE_TRAILING_DAYS = 2;

function plainText(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function fmtDay(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Per-creative aggregation (read shape replicated locally).
// ---------------------------------------------------------------------------

interface CreativeAgg {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  conversionValue: number;
  freqSum: number;
  freqCount: number;
}

function emptyAgg(): CreativeAgg {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    purchases: 0,
    conversionValue: 0,
    freqSum: 0,
    freqCount: 0,
  };
}

// Daily {date, ctr, frequency} point for a creative (stored values, averaged
// across that creative's ads on a given day — never recomputed from
// clicks/impressions).
interface DayPoint {
  date: Date;
  ctr: number | null;
  frequency: number | null;
}

/**
 * Fatigue trend — logic identical to isFatigued() in src/server/digest.ts:
 * sort by date, drop the 2 most recent dates, use stored ctr/frequency
 * directly, require >= 4 usable days, flag when second-half avg CTR is below
 * first-half AND second-half avg frequency is above first-half.
 *
 * The 2 most recent days are excluded because the sync upsert update-branch
 * does not refresh ctr/frequency on re-pulled trailing days, so those points
 * are stale and would distort the trend.
 */
function isFatigued(series: DayPoint[]): boolean {
  const sorted = [...series].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  // Drop the 2 most recent dates (stale on re-pull).
  const stable = sorted.slice(
    0,
    Math.max(0, sorted.length - FATIGUE_STALE_TRAILING_DAYS),
  );
  const usable = stable.filter(
    (d) => d.ctr !== null && d.frequency !== null,
  ) as Array<{ date: Date; ctr: number; frequency: number }>;
  if (usable.length < FATIGUE_MIN_USABLE_DAYS) return false;

  const mid = Math.floor(usable.length / 2);
  const firstHalf = usable.slice(0, mid);
  const secondHalf = usable.slice(mid);

  const avg = (
    arr: Array<{ ctr: number; frequency: number }>,
    key: "ctr" | "frequency",
  ): number => arr.reduce((acc, d) => acc + d[key], 0) / arr.length;

  const ctrFirst = avg(firstHalf, "ctr");
  const ctrSecond = avg(secondHalf, "ctr");
  const freqFirst = avg(firstHalf, "frequency");
  const freqSecond = avg(secondHalf, "frequency");

  const ctrDeclining = ctrSecond < ctrFirst;
  const freqRising = freqSecond > freqFirst;
  return ctrDeclining && freqRising;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { connectionId: string } },
): Promise<Response> {
  // --- Authentication ------------------------------------------------------
  let user;
  try {
    user = await requireUser();
  } catch {
    return plainText(403, "Forbidden");
  }

  // --- Load connection -----------------------------------------------------
  const conn = await db.adAccountConnection.findUnique({
    where: { id: params.connectionId },
    select: {
      id: true,
      clientId: true,
      accountName: true,
      platformAccountId: true,
      currency: true,
      insightsBackfilledAt: true,
      client: { select: { name: true } },
    },
  });
  if (!conn) {
    return plainText(404, "Connection not found");
  }

  // --- Authorization -------------------------------------------------------
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(conn.clientId)) {
    return plainText(403, "Forbidden");
  }

  // --- Hard block: require a completed 30-day insights backfill ------------
  if (!conn.insightsBackfilledAt) {
    return plainText(
      409,
      "This ad account has no completed 30-day insights backfill yet, so a " +
        "creative report cannot be trusted. Run Sync Now and wait for the " +
        "backfill to finish before exporting a creative report.",
    );
  }

  // --- Load creatives + linked ads -----------------------------------------
  const creatives = await db.creative.findMany({
    where: { adAccountConnectionId: conn.id },
    select: {
      id: true,
      name: true,
      type: true,
      headline: true,
      bodyText: true,
      callToAction: true,
      ads: { select: { id: true, name: true } },
    },
  });

  // --- 30 days of ad-level insights ----------------------------------------
  const now = new Date();
  const windowStart = subDays(now, WINDOW_DAYS);
  const adToCreative = new Map<string, string>();
  for (const cr of creatives) {
    for (const ad of cr.ads) adToCreative.set(ad.id, cr.id);
  }
  const adIds = [...adToCreative.keys()];

  const aggByCreative = new Map<string, CreativeAgg>();
  // Per creative → per day-key → accumulating stored ctr/frequency averages.
  const dailyByCreative = new Map<
    string,
    Map<
      string,
      {
        date: Date;
        ctrSum: number;
        ctrCount: number;
        freqSum: number;
        freqCount: number;
      }
    >
  >();
  let maxDate: Date | null = null;

  if (adIds.length > 0) {
    const rows = await db.insightsDaily.findMany({
      where: {
        entityType: "AD",
        entityId: { in: adIds },
        date: { gte: windowStart },
      },
      select: {
        entityId: true,
        date: true,
        spend: true,
        impressions: true,
        clicks: true,
        purchases: true,
        conversionValue: true,
        frequency: true,
        ctr: true,
      },
    });

    for (const r of rows) {
      const creativeId = adToCreative.get(r.entityId);
      if (!creativeId) continue;

      const agg = aggByCreative.get(creativeId) ?? emptyAgg();
      agg.spend += num(r.spend);
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.purchases += r.purchases;
      agg.conversionValue += num(r.conversionValue);
      if (r.frequency !== null) {
        agg.freqSum += num(r.frequency);
        agg.freqCount += 1;
      }
      aggByCreative.set(creativeId, agg);

      if (maxDate === null || r.date > maxDate) maxDate = r.date;

      const dayMap =
        dailyByCreative.get(creativeId) ??
        new Map<
          string,
          {
            date: Date;
            ctrSum: number;
            ctrCount: number;
            freqSum: number;
            freqCount: number;
          }
        >();
      const key = fmtDay(r.date);
      const point = dayMap.get(key) ?? {
        date: r.date,
        ctrSum: 0,
        ctrCount: 0,
        freqSum: 0,
        freqCount: 0,
      };
      if (r.ctr !== null) {
        point.ctrSum += num(r.ctr);
        point.ctrCount += 1;
      }
      if (r.frequency !== null) {
        point.freqSum += num(r.frequency);
        point.freqCount += 1;
      }
      dayMap.set(key, point);
      dailyByCreative.set(creativeId, dayMap);
    }
  }

  // --- Build per-creative rows (spenders only) -----------------------------
  interface Built {
    row: Omit<CreativeReportRow, "verdict">;
    spend: number;
    roas: number;
  }

  const built: Built[] = [];
  for (const cr of creatives) {
    const agg = aggByCreative.get(cr.id);
    if (!agg || agg.spend <= 0) continue;

    const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
    const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : null;
    const roas = agg.spend > 0 ? agg.conversionValue / agg.spend : 0;
    const frequency = agg.freqCount > 0 ? agg.freqSum / agg.freqCount : 0;

    const dayMap = dailyByCreative.get(cr.id);
    const series: DayPoint[] = dayMap
      ? [...dayMap.values()].map((d) => ({
          date: d.date,
          ctr: d.ctrCount > 0 ? d.ctrSum / d.ctrCount : null,
          frequency: d.freqCount > 0 ? d.freqSum / d.freqCount : null,
        }))
      : [];
    const fatigued = isFatigued(series);

    built.push({
      spend: agg.spend,
      roas,
      row: {
        name: cr.name,
        type: cr.type as CreativeType,
        headline: cr.headline,
        bodyText: cr.bodyText,
        callToAction: cr.callToAction,
        spend: agg.spend,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr,
        cpm,
        cpa,
        roas,
        frequency,
        purchases: agg.purchases,
        fatigued,
      },
    });
  }

  built.sort((a, b) => b.spend - a.spend);

  // --- Verdict derivation --------------------------------------------------
  const totalSpend = built.reduce((acc, b) => acc + b.spend, 0);
  // Median ROAS across spenders → "efficiency above the median".
  const roasSorted = built.map((b) => b.roas).sort((a, b) => a - b);
  const medianRoas =
    roasSorted.length === 0
      ? 0
      : roasSorted.length % 2 === 1
        ? roasSorted[(roasSorted.length - 1) / 2]
        : (roasSorted[roasSorted.length / 2 - 1] +
            roasSorted[roasSorted.length / 2]) /
          2;

  function deriveVerdict(b: Built): Verdict {
    const { row } = b;
    // Kill: spending with zero purchases.
    if (row.spend > 0 && row.purchases === 0) return "Kill";
    // Refresh: a fatigue trend is present.
    if (row.fatigued) return "Refresh";
    // Scale: top spend-share AND efficiency above the median of spenders.
    const spendShare = totalSpend > 0 ? b.spend / totalSpend : 0;
    if (spendShare >= SCALE_MIN_SPEND_SHARE && b.roas > medianRoas) {
      return "Scale";
    }
    return "Hold/Watch";
  }

  const rows: CreativeReportRow[] = built.map((b) => ({
    ...b.row,
    verdict: deriveVerdict(b),
  }));

  const verdictCounts = VERDICTS.reduce(
    (acc, v) => {
      acc[v] = 0;
      return acc;
    },
    {} as Record<Verdict, number>,
  );
  for (const r of rows) verdictCounts[r.verdict] += 1;

  // Spend-quality headline: share of spend wasted on Kill creatives
  // (spending with zero purchases).
  const belowThresholdSpend = rows
    .filter((r) => r.verdict === "Kill")
    .reduce((acc, r) => acc + r.spend, 0);
  const belowThresholdSpendPct =
    totalSpend > 0 ? (belowThresholdSpend / totalSpend) * 100 : 0;

  // --- Window label anchored on latest data date present -------------------
  const anchor = maxDate ?? now;
  const windowLabel = `${fmtDay(windowStart)} → ${fmtDay(anchor)} (last ${WINDOW_DAYS} days, anchored on latest data)`;

  const data: CreativeReportData = {
    clientName: conn.client.name,
    accountName: conn.accountName,
    platformAccountId: conn.platformAccountId,
    currency: conn.currency,
    windowLabel,
    generatedAtLabel: format(now, "yyyy-MM-dd HH:mm"),
    creatives: rows,
    verdictCounts,
    belowThresholdSpendPct,
    spenderCount: rows.length,
  };

  // --- Render PDF ----------------------------------------------------------
  const buffer = await renderCreativeReportPdf(data);

  const safeName =
    conn.accountName.replace(/[^a-zA-Z0-9_-]+/g, "-") || "report";
  const fileName = `creative-report-${safeName}-${format(now, "yyyy-MM-dd")}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

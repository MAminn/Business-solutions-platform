import { InsightEntity } from "@prisma/client";
import { db } from "@/lib/db";
import {
  dayUTC,
  isoUTC,
  addDaysUTC,
  labelUTC,
  isValidIsoDate,
  resolveRanges,
  DAY_MS,
} from "@/lib/date-window";

// ============================================================================
// Client Analysis — read-only aggregation over already-synced InsightsDaily.
//
// No Meta calls, no writes, no sync. Everything is derived from the daily
// rows already stored at ACCOUNT / CAMPAIGN / AD level. All date math is
// UTC-based because InsightsDaily.date is a `@db.Date` column (UTC midnight).
// ============================================================================

export type AnalysisLevel = "ACCOUNT" | "CAMPAIGN" | "AD";
export type AnalysisPreset = "7" | "30" | "prev_month" | "custom";

export interface AnalysisParams {
  preset: AnalysisPreset;
  level: AnalysisLevel;
  /** yyyy-MM-dd — only used when preset === "custom". */
  start?: string;
  end?: string;
}

export interface KpiValue {
  current: number;
  previous: number;
}

export interface AnalysisRangeMeta {
  start: string;
  end: string;
  days: number;
}

export interface TimeSeriesPoint {
  date: string; // yyyy-MM-dd
  label: string; // TZ-safe formatted label, e.g. "Jun 1"
  spend: number;
  roas: number;
  cpa: number;
  /** One of the 2 most recent data days (stale ctr/frequency/clicks). */
  provisional: boolean;
}

export interface BreakdownRow {
  id: string;
  name: string;
  spend: number;
  purchases: number;
  conversionValue: number;
  roas: number;
  cpa: number;
}

export interface FatigueHint {
  /** % change in CTR, stable window only (excludes 2 latest data days). */
  ctrTrendPct: number | null;
  /** % change in frequency, stable window only. */
  frequencyTrendPct: number | null;
  note: string | null;
}

export interface AnalysisResult {
  hasData: boolean;
  currency: string;
  timezone: string;
  latestDataDate: string | null;
  level: AnalysisLevel;
  preset: AnalysisPreset;
  range: AnalysisRangeMeta | null;
  prevRange: { start: string; end: string } | null;
  kpis: {
    spend: KpiValue;
    purchases: KpiValue;
    roas: KpiValue;
    purchaseValue: KpiValue;
  };
  timeSeries: TimeSeriesPoint[];
  breakdown: BreakdownRow[];
  /** Accurate totals across ALL entities at the selected level (for "Others"). */
  breakdownTotals: { spend: number; purchases: number };
  fatigue: FatigueHint;
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

interface DailyRow {
  date: Date;
  spend: unknown;
  purchases: number;
  conversionValue: unknown;
  impressions: number;
  clicks: number;
  frequency: unknown;
  ctr: unknown;
}

const ROW_SELECT = {
  date: true,
  spend: true,
  purchases: true,
  conversionValue: true,
  impressions: true,
  clicks: true,
  frequency: true,
  ctr: true,
} as const;

export async function getClientAnalysis(
  clientId: string,
  params: AnalysisParams,
): Promise<AnalysisResult> {
  // ---------------------------------------------------------------------------
  // Resolve account scope: connections (currency/timezone) + campaign/ad IDs.
  // ---------------------------------------------------------------------------
  const connections = await db.adAccountConnection.findMany({
    where: { clientId },
    select: { id: true, accountName: true, currency: true, timezone: true },
  });

  const fallbackCurrency = "USD";
  const currency = connections[0]?.currency ?? fallbackCurrency;
  const timezone = connections[0]?.timezone ?? "UTC";
  const connectionIds = connections.map((c) => c.id);

  const emptyResult: AnalysisResult = {
    hasData: false,
    currency,
    timezone,
    latestDataDate: null,
    level: params.level,
    preset: params.preset,
    range: null,
    prevRange: null,
    kpis: {
      spend: { current: 0, previous: 0 },
      purchases: { current: 0, previous: 0 },
      roas: { current: 0, previous: 0 },
      purchaseValue: { current: 0, previous: 0 },
    },
    timeSeries: [],
    breakdown: [],
    breakdownTotals: { spend: 0, purchases: 0 },
    fatigue: { ctrTrendPct: null, frequencyTrendPct: null, note: null },
  };

  if (connectionIds.length === 0) return emptyResult;

  const [campaigns, ads] = await Promise.all([
    db.campaign.findMany({
      where: { adAccountConnectionId: { in: connectionIds } },
      select: { id: true, name: true },
    }),
    db.ad.findMany({
      where: {
        adSet: {
          campaign: { adAccountConnectionId: { in: connectionIds } },
        },
      },
      select: { id: true, name: true },
    }),
  ]);

  const campaignIds = campaigns.map((c) => c.id);
  const adIds = ads.map((a) => a.id);
  const nameByConnection = new Map(
    connections.map((c) => [c.id, c.accountName]),
  );
  const nameByCampaign = new Map(campaigns.map((c) => [c.id, c.name]));
  const nameByAd = new Map(ads.map((a) => [a.id, a.name]));

  // ---------------------------------------------------------------------------
  // Latest data date — anchor the window here, NOT on "today".
  // Prefer ACCOUNT level; fall back to CAMPAIGN level.
  // ---------------------------------------------------------------------------
  const [accountMax, campaignMax] = await Promise.all([
    db.insightsDaily.aggregate({
      where: {
        entityType: InsightEntity.ACCOUNT,
        entityId: { in: connectionIds },
      },
      _max: { date: true },
    }),
    campaignIds.length > 0
      ? db.insightsDaily.aggregate({
          where: {
            entityType: InsightEntity.CAMPAIGN,
            entityId: { in: campaignIds },
          },
          _max: { date: true },
        })
      : Promise.resolve({ _max: { date: null } }),
  ]);

  const latest = accountMax._max.date ?? campaignMax._max.date ?? null;
  if (!latest) return emptyResult;

  const { start, end, prevStart, prevEnd, days } = resolveRanges(
    params,
    latest,
  );

  // Account totals come from ACCOUNT-level rows when present, else CAMPAIGN.
  const useAccountLevel = accountMax._max.date != null;
  const totalsEntityType = useAccountLevel
    ? InsightEntity.ACCOUNT
    : InsightEntity.CAMPAIGN;
  const totalsEntityIds = useAccountLevel ? connectionIds : campaignIds;

  // ---------------------------------------------------------------------------
  // Pull account-total daily rows across [prevStart .. end] in one query, then
  // split into current vs previous in memory.
  // ---------------------------------------------------------------------------
  const totalRows = (await db.insightsDaily.findMany({
    where: {
      entityType: totalsEntityType,
      entityId: { in: totalsEntityIds },
      date: { gte: prevStart, lte: end },
    },
    select: ROW_SELECT,
    orderBy: { date: "asc" },
  })) as DailyRow[];

  // Aggregate per-day (sum across connections/campaigns) for the time series.
  interface DayAgg {
    spend: number;
    purchases: number;
    conversionValue: number;
    impressions: number;
    clicks: number;
    freqWeighted: number; // frequency * impressions
    ctrWeighted: number; // ctr * impressions
  }
  const currentByDay = new Map<string, DayAgg>();

  const kpis = {
    spend: { current: 0, previous: 0 },
    purchases: { current: 0, previous: 0 },
    roas: { current: 0, previous: 0 },
    purchaseValue: { current: 0, previous: 0 },
  };

  let curConvValue = 0;
  let prevConvValue = 0;

  const startMs = start.getTime();
  const endMs = end.getTime();
  const prevStartMs = prevStart.getTime();
  const prevEndMs = prevEnd.getTime();

  for (const r of totalRows) {
    const t = r.date.getTime();
    const spend = num(r.spend);
    const purchases = num(r.purchases);
    const convValue = num(r.conversionValue);

    if (t >= startMs && t <= endMs) {
      kpis.spend.current += spend;
      kpis.purchases.current += purchases;
      curConvValue += convValue;

      const key = isoUTC(r.date);
      const agg = currentByDay.get(key) ?? {
        spend: 0,
        purchases: 0,
        conversionValue: 0,
        impressions: 0,
        clicks: 0,
        freqWeighted: 0,
        ctrWeighted: 0,
      };
      const imp = num(r.impressions);
      agg.spend += spend;
      agg.purchases += purchases;
      agg.conversionValue += convValue;
      agg.impressions += imp;
      agg.clicks += num(r.clicks);
      if (r.frequency !== null && r.frequency !== undefined && imp > 0) {
        agg.freqWeighted += num(r.frequency) * imp;
      }
      if (r.ctr !== null && r.ctr !== undefined && imp > 0) {
        agg.ctrWeighted += num(r.ctr) * imp;
      }
      currentByDay.set(key, agg);
    } else if (t >= prevStartMs && t <= prevEndMs) {
      kpis.spend.previous += spend;
      kpis.purchases.previous += purchases;
      prevConvValue += convValue;
    }
  }

  kpis.purchaseValue.current = curConvValue;
  kpis.purchaseValue.previous = prevConvValue;
  kpis.roas.current =
    kpis.spend.current > 0 ? curConvValue / kpis.spend.current : 0;
  kpis.roas.previous =
    kpis.spend.previous > 0 ? prevConvValue / kpis.spend.previous : 0;

  // ---------------------------------------------------------------------------
  // Time series: one point per calendar day in [start .. end] (plot ALL days).
  // ---------------------------------------------------------------------------
  const sortedDayKeys = Array.from(currentByDay.keys()).sort();
  // The 2 most recent data days present in the window are "provisional".
  const provisionalKeys = new Set(sortedDayKeys.slice(-2));

  const timeSeries: TimeSeriesPoint[] = [];
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    const d = new Date(t);
    const key = isoUTC(d);
    const agg = currentByDay.get(key);
    const spend = agg?.spend ?? 0;
    const convValue = agg?.conversionValue ?? 0;
    const purchases = agg?.purchases ?? 0;
    timeSeries.push({
      date: key,
      label: labelUTC(d),
      spend,
      roas: spend > 0 ? convValue / spend : 0,
      cpa: purchases > 0 ? spend / purchases : 0,
      provisional: provisionalKeys.has(key),
    });
  }

  // ---------------------------------------------------------------------------
  // Fatigue / trend hint — STABLE window only (exclude 2 most recent data days).
  // First-half vs second-half average of impressions-weighted ctr & frequency.
  // ---------------------------------------------------------------------------
  const stableKeys = sortedDayKeys.filter((k) => !provisionalKeys.has(k));
  const fatigue = computeFatigue(stableKeys, currentByDay);

  // ---------------------------------------------------------------------------
  // Breakdown (selected level), current range only. Used by both bar charts
  // and the table. Totals computed separately for accurate "Others".
  // ---------------------------------------------------------------------------
  let entityType: InsightEntity;
  let entityIds: string[];
  let nameMap: Map<string, string>;
  if (params.level === "ACCOUNT") {
    entityType = InsightEntity.ACCOUNT;
    entityIds = connectionIds;
    nameMap = nameByConnection;
  } else if (params.level === "CAMPAIGN") {
    entityType = InsightEntity.CAMPAIGN;
    entityIds = campaignIds;
    nameMap = nameByCampaign;
  } else {
    entityType = InsightEntity.AD;
    entityIds = adIds;
    nameMap = nameByAd;
  }

  let breakdown: BreakdownRow[] = [];
  const breakdownTotals = { spend: 0, purchases: 0 };

  if (entityIds.length > 0) {
    const grouped = await db.insightsDaily.groupBy({
      by: ["entityId"],
      where: {
        entityType,
        entityId: { in: entityIds },
        date: { gte: start, lte: end },
      },
      _sum: { spend: true, purchases: true, conversionValue: true },
    });

    breakdown = grouped
      .map((g) => {
        const spend = num(g._sum.spend);
        const purchases = num(g._sum.purchases);
        const conversionValue = num(g._sum.conversionValue);
        breakdownTotals.spend += spend;
        breakdownTotals.purchases += purchases;
        return {
          id: g.entityId,
          name: nameMap.get(g.entityId) ?? "(unknown)",
          spend,
          purchases,
          conversionValue,
          roas: spend > 0 ? conversionValue / spend : 0,
          cpa: purchases > 0 ? spend / purchases : 0,
        };
      })
      .filter((r) => r.spend > 0 || r.purchases > 0)
      .sort((a, b) => b.spend - a.spend);
  }

  return {
    hasData: timeSeries.some((p) => p.spend > 0) || breakdown.length > 0,
    currency,
    timezone,
    latestDataDate: isoUTC(latest),
    level: params.level,
    preset: params.preset,
    range: { start: isoUTC(start), end: isoUTC(end), days },
    prevRange: { start: isoUTC(prevStart), end: isoUTC(prevEnd) },
    kpis,
    timeSeries,
    breakdown,
    breakdownTotals,
    fatigue,
  };
}

function computeFatigue(
  stableKeys: string[],
  byDay: Map<
    string,
    {
      impressions: number;
      freqWeighted: number;
      ctrWeighted: number;
    }
  >,
): FatigueHint {
  if (stableKeys.length < 6) {
    return { ctrTrendPct: null, frequencyTrendPct: null, note: null };
  }
  const mid = Math.floor(stableKeys.length / 2);
  const firstHalf = stableKeys.slice(0, mid);
  const secondHalf = stableKeys.slice(mid);

  const avg = (keys: string[], pick: "ctr" | "freq"): number | null => {
    let weighted = 0;
    let imp = 0;
    for (const k of keys) {
      const a = byDay.get(k);
      if (!a) continue;
      imp += a.impressions;
      weighted += pick === "ctr" ? a.ctrWeighted : a.freqWeighted;
    }
    return imp > 0 ? weighted / imp : null;
  };

  const ctrA = avg(firstHalf, "ctr");
  const ctrB = avg(secondHalf, "ctr");
  const freqA = avg(firstHalf, "freq");
  const freqB = avg(secondHalf, "freq");

  const pct = (a: number | null, b: number | null): number | null =>
    a !== null && b !== null && a > 0 ? ((b - a) / a) * 100 : null;

  const ctrTrendPct = pct(ctrA, ctrB);
  const frequencyTrendPct = pct(freqA, freqB);

  let note: string | null = null;
  if (
    ctrTrendPct !== null &&
    frequencyTrendPct !== null &&
    frequencyTrendPct > 5 &&
    ctrTrendPct < -5
  ) {
    note = "Possible fatigue: frequency rising while CTR declines.";
  } else if (ctrTrendPct !== null && ctrTrendPct < -10) {
    note = "CTR trending down over the period.";
  } else if (ctrTrendPct !== null && ctrTrendPct > 10) {
    note = "CTR trending up over the period.";
  }

  return { ctrTrendPct, frequencyTrendPct, note };
}

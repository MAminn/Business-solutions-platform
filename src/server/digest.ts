"use server";

import { subDays, format } from "date-fns";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { InsightEntity } from "@prisma/client";
import type { ConnectionStatus } from "@prisma/client";

// ============================================================================
// Per-account Markdown digest builder.
//
// Read-only. Aggregates already-synced InsightsDaily rows for a single
// AdAccountConnection into a Markdown report. Mirrors the ad-level insight
// aggregation pattern used in
// src/app/(app)/clients/[id]/creatives/page.tsx and the
// requireUser()/getAccessibleClientIds() access-control pattern used across
// the server layer (e.g. src/server/sync.ts).
//
// Revenue / ROAS / CPA are Meta-reported and not reconciled against real
// sales. The digest states this explicitly.
// ============================================================================

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

/** Format a currency value without relying on a hardcoded symbol set. */
function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Unknown/invalid ISO currency code — fall back to a plain number.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** CTR / frequency etc. are stored in 0-100 (percent) or raw units already. */
function pct(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

function mult(value: number, digits = 2): string {
  return `${value.toFixed(digits)}x`;
}

/** Signed percentage change between two values; null when prev is non-positive. */
function pctChange(curr: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

function deltaLabel(curr: number, prev: number): string {
  const change = pctChange(curr, prev);
  if (change === null) return "n/a";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(1)}%`;
}

function fmtDate(value: Date | null | undefined): string {
  if (!value) return "never";
  return format(value, "yyyy-MM-dd HH:mm");
}

function fmtDay(value: Date | null | undefined): string {
  if (!value) return "—";
  return format(value, "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Aggregation shapes
// ---------------------------------------------------------------------------

interface CoreAgg {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  purchases: number;
  conversionValue: number;
  reach: number;
  freqSum: number;
  freqCount: number;
}

function emptyAgg(): CoreAgg {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    purchases: 0,
    conversionValue: 0,
    reach: 0,
    freqSum: 0,
    freqCount: 0,
  };
}

interface InsightRow {
  entityId: string;
  date: Date;
  spend: unknown;
  impressions: number;
  clicks: number;
  conversions: number;
  purchases: number;
  conversionValue: unknown;
  reach: number;
  frequency: unknown;
  ctr: unknown;
}

function addRow(agg: CoreAgg, r: InsightRow): void {
  agg.spend += num(r.spend);
  agg.impressions += r.impressions;
  agg.clicks += r.clicks;
  agg.conversions += r.conversions;
  agg.purchases += r.purchases;
  agg.conversionValue += num(r.conversionValue);
  agg.reach += r.reach;
  if (r.frequency !== null && r.frequency !== undefined) {
    agg.freqSum += num(r.frequency);
    agg.freqCount += 1;
  }
}

// Derived metrics from a CoreAgg.
function cpm(a: CoreAgg): number {
  return a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
}
function ctr(a: CoreAgg): number {
  return a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
}
function cpc(a: CoreAgg): number {
  return a.clicks > 0 ? a.spend / a.clicks : 0;
}
function frequency(a: CoreAgg): number {
  return a.freqCount > 0 ? a.freqSum / a.freqCount : 0;
}
function cpa(a: CoreAgg): number {
  return a.purchases > 0 ? a.spend / a.purchases : 0;
}
function roas(a: CoreAgg): number {
  return a.spend > 0 ? a.conversionValue / a.spend : 0;
}

// ---------------------------------------------------------------------------
// Header block (account identity + sync-health staleness warnings)
// ---------------------------------------------------------------------------

interface HeaderConn {
  accountName: string;
  platformAccountId: string;
  currency: string;
  timezone: string;
  structuralSyncedAt: Date | null;
  insightsBackfilledAt: Date | null;
  lastSyncedAt: Date | null;
  status: ConnectionStatus;
  lastSyncError: string | null;
  tokenExpiresAt: Date | null;
  client: { name: string };
}

/**
 * Pushes the shared "## Account" header block. Includes the three sync
 * timestamps plus sync-health staleness warnings (connection status, last
 * sync error, token expiry). These warnings never block generation — they
 * only annotate that the historical rows may be stale.
 */
function pushHeaderBlock(lines: string[], conn: HeaderConn): void {
  lines.push("## Account");
  lines.push("");
  lines.push(`- **Client:** ${conn.client.name}`);
  lines.push(`- **Account:** ${conn.accountName} (${conn.platformAccountId})`);
  lines.push(`- **Currency:** ${conn.currency}`);
  lines.push(`- **Timezone:** ${conn.timezone}`);
  lines.push(`- **Structural synced:** ${fmtDate(conn.structuralSyncedAt)}`);
  lines.push(
    `- **Insights backfilled:** ${fmtDate(conn.insightsBackfilledAt)}`,
  );
  lines.push(`- **Last synced:** ${fmtDate(conn.lastSyncedAt)}`);

  // Sync-health staleness warnings (non-blocking).
  if (conn.status !== "ACTIVE") {
    lines.push(
      `- **Connection status:** ${conn.status} — future syncs may fail, ` +
        `so this data could be stale.`,
    );
  } else {
    lines.push(`- **Connection status:** ${conn.status}`);
  }

  if (conn.lastSyncError !== null) {
    lines.push(
      `- **Last sync error:** ${escapeInline(conn.lastSyncError)} — the most ` +
        `recent sync attempt errored, so data may not be current.`,
    );
  }

  if (conn.tokenExpiresAt !== null) {
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (conn.tokenExpiresAt <= sevenDaysOut) {
      const expired = conn.tokenExpiresAt.getTime() <= Date.now();
      lines.push(
        `- **Meta token:** ${expired ? "expired" : "expiring"} ` +
          `(${fmtDate(conn.tokenExpiresAt)}) — data may stop updating ` +
          `until the connection is re-authorized.`,
      );
    }
  }
}

/** Collapse newlines so a stored error cannot break the Markdown list item. */
function escapeInline(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export async function buildAccountDigest(
  connectionId: string,
): Promise<string> {
  const user = await requireUser();

  const conn = await db.adAccountConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      clientId: true,
      accountName: true,
      platformAccountId: true,
      currency: true,
      timezone: true,
      structuralSyncedAt: true,
      insightsBackfilledAt: true,
      lastSyncedAt: true,
      status: true,
      lastSyncError: true,
      tokenExpiresAt: true,
      client: { select: { name: true } },
    },
  });
  if (!conn) throw new Error("Connection not found");

  // Access control — same path as the rest of the server layer.
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(conn.clientId)) {
    throw new Error("Forbidden");
  }

  // Hard block: trust data only after a successful 30-day insights backfill
  // (PASS). When insightsBackfilledAt is null we render the header for context
  // but no metric/campaign/ad tables — partial data must not look complete.
  if (conn.insightsBackfilledAt === null) {
    return renderBackfillUnavailable(conn);
  }

  const currency = conn.currency;
  const now = new Date();
  const since30 = subDays(now, 30);

  // -------------------------------------------------------------------------
  // Pull entity ID maps for this connection (campaigns, ads + names).
  // -------------------------------------------------------------------------
  const campaigns = await db.campaign.findMany({
    where: { adAccountConnectionId: connectionId },
    select: { id: true, name: true },
  });
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const campaignIds = campaigns.map((c) => c.id);

  const ads = await db.ad.findMany({
    where: { adSet: { campaign: { adAccountConnectionId: connectionId } } },
    select: {
      id: true,
      name: true,
      adSet: { select: { campaign: { select: { name: true } } } },
      creative: { select: { name: true } },
    },
  });
  const adIds = ads.map((a) => a.id);
  const adMeta = new Map(
    ads.map((a) => [
      a.id,
      {
        name: a.name,
        campaign: a.adSet?.campaign?.name ?? null,
        creative: a.creative?.name ?? null,
      },
    ]),
  );

  // -------------------------------------------------------------------------
  // Account-level rows (preferred). Fall back to campaign-level if absent.
  // -------------------------------------------------------------------------
  const accountRows = await db.insightsDaily.findMany({
    where: {
      entityType: InsightEntity.ACCOUNT,
      entityId: conn.id,
      date: { gte: since30 },
    },
    select: {
      entityId: true,
      date: true,
      spend: true,
      impressions: true,
      clicks: true,
      conversions: true,
      purchases: true,
      conversionValue: true,
      reach: true,
      frequency: true,
      ctr: true,
    },
    orderBy: { date: "asc" },
  });

  const campaignRows =
    campaignIds.length > 0
      ? await db.insightsDaily.findMany({
          where: {
            entityType: InsightEntity.CAMPAIGN,
            entityId: { in: campaignIds },
            date: { gte: since30 },
          },
          select: {
            entityId: true,
            date: true,
            spend: true,
            impressions: true,
            clicks: true,
            conversions: true,
            purchases: true,
            conversionValue: true,
            reach: true,
            frequency: true,
            ctr: true,
          },
          orderBy: { date: "asc" },
        })
      : [];

  const adRows =
    adIds.length > 0
      ? await db.insightsDaily.findMany({
          where: {
            entityType: InsightEntity.AD,
            entityId: { in: adIds },
            date: { gte: since30 },
          },
          select: {
            entityId: true,
            date: true,
            spend: true,
            impressions: true,
            clicks: true,
            conversions: true,
            purchases: true,
            conversionValue: true,
            reach: true,
            frequency: true,
            ctr: true,
          },
          orderBy: { date: "asc" },
        })
      : [];

  // -------------------------------------------------------------------------
  // Determine the actual data date range present (across all levels seen).
  // -------------------------------------------------------------------------
  const allDates: Date[] = [
    ...accountRows.map((r) => r.date),
    ...campaignRows.map((r) => r.date),
    ...adRows.map((r) => r.date),
  ];
  const minDate =
    allDates.length > 0
      ? new Date(Math.min(...allDates.map((d) => d.getTime())))
      : null;
  const maxDate =
    allDates.length > 0
      ? new Date(Math.max(...allDates.map((d) => d.getTime())))
      : null;

  // Empty/no-data short-circuit.
  if (allDates.length === 0) {
    return renderEmpty(conn, currency);
  }

  // 7-day windows are anchored on the latest date present in the data, so a
  // stale "today" with no rows yet does not blank out the recent window.
  const anchor = maxDate ?? now;
  const last7Start = subDays(anchor, 6);
  const prev7Start = subDays(anchor, 13);
  const prev7End = subDays(anchor, 7);

  function inLast7(d: Date): boolean {
    return d >= last7Start && d <= anchor;
  }
  function inPrev7(d: Date): boolean {
    return d >= prev7Start && d <= prev7End;
  }

  // -------------------------------------------------------------------------
  // Account metrics: account-level rows if present, else campaign-level
  // (labelled as derived).
  // -------------------------------------------------------------------------
  const usingDerivedAccount = accountRows.length === 0;
  const accountSource: InsightRow[] = usingDerivedAccount
    ? campaignRows
    : accountRows;

  const acctLast7 = emptyAgg();
  const acctPrev7 = emptyAgg();
  const acct30 = emptyAgg();
  const distinctDayKeys = new Set<string>();
  for (const r of accountSource) {
    addRow(acct30, r);
    distinctDayKeys.add(fmtDay(r.date));
    if (inLast7(r.date)) addRow(acctLast7, r);
    if (inPrev7(r.date)) addRow(acctPrev7, r);
  }
  const distinctDays = distinctDayKeys.size;
  // 30-day "average" per-day denominator: distinct days actually present.
  const dayDiv = distinctDays > 0 ? distinctDays : 1;

  // -------------------------------------------------------------------------
  // Campaign breakdown: per-campaign last7 / prev7.
  // -------------------------------------------------------------------------
  const campLast7 = new Map<string, CoreAgg>();
  const campPrev7 = new Map<string, CoreAgg>();
  for (const r of campaignRows) {
    if (inLast7(r.date)) {
      const a = campLast7.get(r.entityId) ?? emptyAgg();
      addRow(a, r);
      campLast7.set(r.entityId, a);
    }
    if (inPrev7(r.date)) {
      const a = campPrev7.get(r.entityId) ?? emptyAgg();
      addRow(a, r);
      campPrev7.set(r.entityId, a);
    }
  }

  // -------------------------------------------------------------------------
  // Ad breakdown: per-ad last7 + per-ad daily series (for fatigue).
  // -------------------------------------------------------------------------
  const adLast7 = new Map<string, CoreAgg>();
  const adDaily = new Map<
    string,
    Array<{ date: Date; ctr: number | null; frequency: number | null }>
  >();
  for (const r of adRows) {
    if (inLast7(r.date)) {
      const a = adLast7.get(r.entityId) ?? emptyAgg();
      addRow(a, r);
      adLast7.set(r.entityId, a);
    }
    const series = adDaily.get(r.entityId) ?? [];
    series.push({
      date: r.date,
      ctr: r.ctr === null || r.ctr === undefined ? null : num(r.ctr),
      frequency:
        r.frequency === null || r.frequency === undefined
          ? null
          : num(r.frequency),
    });
    adDaily.set(r.entityId, series);
  }

  // =========================================================================
  // Render
  // =========================================================================
  const lines: string[] = [];

  lines.push(`# Account digest — ${conn.client.name}`);
  lines.push("");

  lines.push(
    "> Revenue, ROAS, and CPA are Meta-reported and not reconciled against real sales.",
  );
  lines.push("");

  // Header block (shared) + the data-range line specific to a rendered digest.
  pushHeaderBlock(lines, conn);
  lines.push(
    `- **Data range present:** ${fmtDay(minDate)} → ${fmtDay(maxDate)} ` +
      `(${distinctDays} distinct day${distinctDays === 1 ? "" : "s"})`,
  );
  lines.push("");

  // Account metrics table.
  lines.push("## Account metrics");
  lines.push("");
  if (usingDerivedAccount) {
    lines.push(
      "_No account-level rows present — figures below are **derived** by " +
        "summing campaign-level rows._",
    );
    lines.push("");
  }

  const avg30Spend = acct30.spend / dayDiv;
  // For rate metrics the 30-day "average" is the windowed rate over all days.
  lines.push("| Metric | Last 7d | Prev 7d | Δ | 30d avg/day |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  lines.push(
    `| Spend | ${money(acctLast7.spend, currency)} | ${money(
      acctPrev7.spend,
      currency,
    )} | ${deltaLabel(acctLast7.spend, acctPrev7.spend)} | ${money(
      avg30Spend,
      currency,
    )} |`,
  );
  lines.push(
    `| CPM | ${money(cpm(acctLast7), currency)} | ${money(
      cpm(acctPrev7),
      currency,
    )} | ${deltaLabel(cpm(acctLast7), cpm(acctPrev7))} | ${money(
      cpm(acct30),
      currency,
    )} |`,
  );
  lines.push(
    `| CTR | ${pct(ctr(acctLast7))} | ${pct(ctr(acctPrev7))} | ${deltaLabel(
      ctr(acctLast7),
      ctr(acctPrev7),
    )} | ${pct(ctr(acct30))} |`,
  );
  lines.push(
    `| CPC | ${money(cpc(acctLast7), currency)} | ${money(
      cpc(acctPrev7),
      currency,
    )} | ${deltaLabel(cpc(acctLast7), cpc(acctPrev7))} | ${money(
      cpc(acct30),
      currency,
    )} |`,
  );
  lines.push(
    `| Frequency | ${mult(frequency(acctLast7))} | ${mult(
      frequency(acctPrev7),
    )} | ${deltaLabel(
      frequency(acctLast7),
      frequency(acctPrev7),
    )} | ${mult(frequency(acct30))} |`,
  );
  lines.push(
    `| CPA (Meta) | ${money(cpa(acctLast7), currency)} | ${money(
      cpa(acctPrev7),
      currency,
    )} | ${deltaLabel(cpa(acctLast7), cpa(acctPrev7))} | ${money(
      cpa(acct30),
      currency,
    )} |`,
  );
  lines.push(
    `| ROAS (Meta) | ${mult(roas(acctLast7))} | ${mult(
      roas(acctPrev7),
    )} | ${deltaLabel(roas(acctLast7), roas(acctPrev7))} | ${mult(
      roas(acct30),
    )} |`,
  );
  lines.push(
    `| Purchases | ${acctLast7.purchases} | ${acctPrev7.purchases} | ${deltaLabel(
      acctLast7.purchases,
      acctPrev7.purchases,
    )} | ${acct30.purchases} |`,
  );
  lines.push(
    `| Conversions | ${acctLast7.conversions} | ${acctPrev7.conversions} | ${deltaLabel(
      acctLast7.conversions,
      acctPrev7.conversions,
    )} | ${acct30.conversions} |`,
  );
  lines.push("");

  // -------------------------------------------------------------------------
  // Campaigns: top 10 by 7-day spend.
  // -------------------------------------------------------------------------
  lines.push("## Campaigns (top 10 by 7-day spend)");
  lines.push("");
  const rankedCampaigns = [...campLast7.entries()]
    .map(([id, agg]) => ({ id, agg }))
    .filter((c) => c.agg.spend > 0)
    .sort((a, b) => b.agg.spend - a.agg.spend)
    .slice(0, 10);

  if (rankedCampaigns.length === 0) {
    lines.push("_No campaign spend in the last 7 days._");
    lines.push("");
  } else {
    lines.push(
      "| Campaign | 7d spend | Prev 7d | Δ spend | CPA | ROAS | Flag |",
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | :--- |");
    for (const c of rankedCampaigns) {
      const prev = campPrev7.get(c.id) ?? emptyAgg();
      const cpaCurr = cpa(c.agg);
      const cpaPrev = cpa(prev);
      const cpmCurr = cpm(c.agg);
      const cpmPrev = cpm(prev);
      const cpaDiv = pctChange(cpaCurr, cpaPrev);
      const cpmDiv = pctChange(cpmCurr, cpmPrev);
      const flags: string[] = [];
      // Direction-aware: for CPA/CPM, an INCREASE beyond threshold is a
      // worsening (⚠️); a DECREASE beyond threshold is an improvement (✅).
      // No baseline (pctChange === null) emits no flag.
      if (cpaDiv !== null && Math.abs(cpaDiv) > 25) {
        const marker = cpaDiv > 0 ? "⚠️" : "✅";
        flags.push(
          `${marker} CPA ${cpaDiv > 0 ? "+" : ""}${cpaDiv.toFixed(0)}%`,
        );
      }
      if (cpmDiv !== null && Math.abs(cpmDiv) > 25) {
        const marker = cpmDiv > 0 ? "⚠️" : "✅";
        flags.push(
          `${marker} CPM ${cpmDiv > 0 ? "+" : ""}${cpmDiv.toFixed(0)}%`,
        );
      }
      const name = campaignName.get(c.id) ?? c.id;
      lines.push(
        `| ${escapeCell(name)} | ${money(c.agg.spend, currency)} | ${money(
          prev.spend,
          currency,
        )} | ${deltaLabel(c.agg.spend, prev.spend)} | ${money(
          cpaCurr,
          currency,
        )} | ${mult(roas(c.agg))} | ${flags.join(", ")} |`,
      );
    }
    lines.push("");
  }

  // -------------------------------------------------------------------------
  // Ads / creatives.
  // -------------------------------------------------------------------------
  lines.push("## Ads / creatives");
  lines.push("");

  const adsWithSpend = [...adLast7.entries()]
    .map(([id, agg]) => ({ id, agg }))
    .filter((a) => a.agg.spend > 0);

  if (adsWithSpend.length === 0) {
    lines.push("_No ad spend in the last 7 days._");
    lines.push("");
  } else {
    // Top 5 by spend.
    const topBySpend = [...adsWithSpend]
      .sort((a, b) => b.agg.spend - a.agg.spend)
      .slice(0, 5);
    // Bottom 5 by efficiency = highest CPA among ads with spend.
    // Ads with zero purchases (CPA undefined) are pushed to the worst end.
    const bottomByEff = [...adsWithSpend]
      .sort((a, b) => effRank(b.agg) - effRank(a.agg))
      .slice(0, 5);

    lines.push("### Top 5 ads by spend");
    lines.push("");
    lines.push("| Ad | 7d spend | CPA | CTR | Freq | Fatigue |");
    lines.push("| --- | ---: | ---: | ---: | ---: | :--- |");
    for (const a of topBySpend) {
      lines.push(adRowLine(a.id, a.agg, currency, adMeta, adDaily));
    }
    lines.push("");

    lines.push("### Bottom 5 ads by efficiency (Meta CPA, ads with spend)");
    lines.push("");
    lines.push("| Ad | 7d spend | CPA | CTR | Freq | Fatigue |");
    lines.push("| --- | ---: | ---: | ---: | ---: | :--- |");
    for (const a of bottomByEff) {
      lines.push(adRowLine(a.id, a.agg, currency, adMeta, adDaily));
    }
    lines.push("");
  }

  // -------------------------------------------------------------------------
  // Structural line: spend concentration over the 30-day campaign rows.
  // -------------------------------------------------------------------------
  const campSpend30 = new Map<string, number>();
  for (const r of campaignRows) {
    campSpend30.set(
      r.entityId,
      (campSpend30.get(r.entityId) ?? 0) + num(r.spend),
    );
  }
  const totalCampaigns = campaignIds.length;
  const spendValues = [...campSpend30.values()]
    .filter((s) => s > 0)
    .sort((a, b) => b - a);
  const totalSpend30 = spendValues.reduce((acc, s) => acc + s, 0);

  lines.push("## Structure");
  lines.push("");
  if (totalSpend30 > 0 && spendValues.length > 0) {
    // Smallest set of campaigns covering >= 75% of spend.
    let cumulative = 0;
    let topN = 0;
    for (const s of spendValues) {
      cumulative += s;
      topN += 1;
      if (cumulative / totalSpend30 >= 0.75) break;
    }
    const sharePct = (cumulative / totalSpend30) * 100;
    lines.push(
      `- **Spend concentration:** ${sharePct.toFixed(0)}% of 30-day spend in ` +
        `${topN} of ${totalCampaigns} campaigns ` +
        `(${spendValues.length} campaigns had any spend).`,
    );
  } else {
    lines.push(
      `- **Spend concentration:** no campaign spend in the last 30 days ` +
        `(${totalCampaigns} campaigns total).`,
    );
  }
  lines.push("");

  lines.push("---");
  lines.push(
    `_Generated ${fmtDate(now)} · windows anchored on ${fmtDay(anchor)} · ` +
      `fatigue trend excludes the 2 most recent days (stale on re-pull)._`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Ad row + fatigue helpers
// ---------------------------------------------------------------------------

/** Efficiency rank: higher = worse. Ads with no purchases rank worst. */
function effRank(a: CoreAgg): number {
  if (a.purchases <= 0) return Number.MAX_SAFE_INTEGER;
  return a.spend / a.purchases;
}

/**
 * Fatigue: declining CTR while frequency rises, over the STABLE older days
 * only. The two most recent dates are dropped because the sync upsert
 * update-branch does not refresh ctr/frequency on re-pulled trailing days.
 * Uses stored ctr/frequency directly (clicks is also not refreshed on
 * re-pull, so CTR must not be recomputed from clicks/impressions).
 */
function isFatigued(
  series: Array<{ date: Date; ctr: number | null; frequency: number | null }>,
): boolean {
  const sorted = [...series].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  // Drop the 2 most recent dates.
  const stable = sorted.slice(0, Math.max(0, sorted.length - 2));
  const usable = stable.filter(
    (d) => d.ctr !== null && d.frequency !== null,
  ) as Array<{ date: Date; ctr: number; frequency: number }>;
  // Need a meaningful series to call a trend.
  if (usable.length < 4) return false;

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

function adRowLine(
  id: string,
  agg: CoreAgg,
  currency: string,
  adMeta: Map<
    string,
    { name: string; campaign: string | null; creative: string | null }
  >,
  adDaily: Map<
    string,
    Array<{ date: Date; ctr: number | null; frequency: number | null }>
  >,
): string {
  const meta = adMeta.get(id);
  const name = meta?.name ?? id;
  const series = adDaily.get(id) ?? [];
  // "Meaningful spend" gate for fatigue: only flag ads with non-trivial spend.
  const meaningful = agg.spend > 0;
  const fatigue = meaningful && isFatigued(series) ? "⚠️ fatigue" : "";
  return `| ${escapeCell(name)} | ${money(agg.spend, currency)} | ${money(
    cpa(agg),
    currency,
  )} | ${pct(ctr(agg))} | ${mult(frequency(agg))} | ${fatigue} |`;
}

/** Escape pipe / newline so a name cannot break the Markdown table. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Empty render
// ---------------------------------------------------------------------------

function renderEmpty(conn: HeaderConn, currency: string): string {
  void currency; // currency is part of the shared header block.
  const lines: string[] = [];
  lines.push(`# Account digest — ${conn.client.name}`);
  lines.push("");
  lines.push(
    "> Revenue, ROAS, and CPA are Meta-reported and not reconciled against real sales.",
  );
  lines.push("");
  pushHeaderBlock(lines, conn);
  lines.push("");
  lines.push(
    "**No insights data is present for this connection in the last 30 days.** " +
      "Run a sync to populate performance data before generating a digest.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Backfill-unavailable render (hard block — item 1)
// ---------------------------------------------------------------------------

/**
 * Returned when insightsBackfilledAt is null: no 30-day backfill has
 * completed (no PASS), so the digest is unavailable. Renders the header for
 * context but deliberately omits every metric / campaign / ad table.
 */
function renderBackfillUnavailable(conn: HeaderConn): string {
  const lines: string[] = [];
  lines.push(`# Account digest — ${conn.client.name}`);
  lines.push("");
  lines.push(
    "> ⚠️ **Digest unavailable — insights backfill not complete.** " +
      "This account has not finished a 30-day insights backfill " +
      "(`insightsBackfilledAt` is null), so the data cannot be trusted yet. " +
      "Run an initial sync first, then regenerate.",
  );
  lines.push("");
  lines.push(
    "> Revenue, ROAS, and CPA are Meta-reported and not reconciled against real sales.",
  );
  lines.push("");
  pushHeaderBlock(lines, conn);
  return lines.join("\n");
}

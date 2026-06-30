"use client";

import * as React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Play } from "lucide-react";
import type { CreativeType } from "@prisma/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatCurrencyExact,
  formatInt,
  formatMultiplier,
  formatPercent,
} from "@/lib/format";

// ---------------------------------------------------------------------------
// Types (serializable — mirror what the server passes)
// ---------------------------------------------------------------------------

export interface CreativeDailyPoint {
  date: string; // yyyy-MM-dd
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  conversionValue: number;
  frequency: number | null;
  ctr: number | null; // STORED per-day ctr (for the fatigue trend only)
}

export interface CreativeLinkedAd {
  id: string;
  name: string | null;
  effectiveStatus: string | null;
  adsetName: string | null;
  campaignName: string | null;
}

export interface CreativeItem {
  id: string;
  name: string;
  type: CreativeType;
  status: string | null;
  preview: string | null;
  bodyText: string | null;
  headline: string | null;
  callToAction: string | null;
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
  adPlatformId: string | null;
  launchDate: string | null; // ISO
  reviewUrl: string | null;
  hasRealPostPreview: boolean;
  postId: string | null;
  daily: CreativeDailyPoint[];
  linkedAds?: CreativeLinkedAd[];
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

interface Aggregate {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  conversionValue: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  roas: number;
  hasData: boolean;
}

function aggregate(points: CreativeDailyPoint[]): Aggregate {
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let purchases = 0;
  let conversionValue = 0;
  let freqSum = 0;
  let freqCount = 0;
  for (const p of points) {
    spend += p.spend;
    impressions += p.impressions;
    clicks += p.clicks;
    purchases += p.purchases;
    conversionValue += p.conversionValue;
    if (p.frequency !== null) {
      freqSum += p.frequency;
      freqCount += 1;
    }
  }
  return {
    spend,
    impressions,
    clicks,
    purchases,
    conversionValue,
    frequency: freqCount > 0 ? freqSum / freqCount : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpa: purchases > 0 ? spend / purchases : 0,
    roas: spend > 0 ? conversionValue / spend : 0,
    hasData: impressions > 0 || spend > 0,
  };
}

/** Latest data date across all creatives (yyyy-MM-dd string compare is safe). */
function latestDate(items: CreativeItem[]): string | null {
  let max: string | null = null;
  for (const it of items) {
    for (const p of it.daily) {
      if (max === null || p.date > max) max = p.date;
    }
  }
  return max;
}

function cutoffFor(reference: string | null, days: number): string {
  if (!reference) return "";
  const d = parseISO(reference);
  d.setDate(d.getDate() - (days - 1));
  return format(d, "yyyy-MM-dd");
}

function withinWindow(
  points: CreativeDailyPoint[],
  cutoff: string,
): CreativeDailyPoint[] {
  if (!cutoff) return points;
  return points.filter((p) => p.date >= cutoff);
}

/**
 * Fatigue trend — copied from src/server/digest.ts `isFatigued` (deliberately
 * NOT imported this phase). Declining stored CTR while stored frequency rises,
 * over the STABLE older days only: sort ascending, drop the 2 most recent
 * dates (the sync update-branch does not refresh ctr/frequency on re-pulled
 * trailing days), keep days where BOTH stored ctr and frequency are present,
 * require >= 4 usable days, then compare first-half vs second-half averages.
 * Uses STORED per-day ctr/frequency directly — never the aggregate-level
 * clicks/impressions ctr. (Date is a yyyy-MM-dd string here; lexical sort is
 * equivalent to chronological, so behavior matches the digest.)
 */
function isFatigued(series: CreativeDailyPoint[]): boolean {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  // Drop the 2 most recent dates.
  const stable = sorted.slice(0, Math.max(0, sorted.length - 2));
  const usable = stable.filter(
    (d) => d.ctr !== null && d.frequency !== null,
  ) as Array<{ ctr: number; frequency: number }>;
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

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------

const TYPE_VARIANT: Record<CreativeType, "info" | "warning" | "muted"> = {
  IMAGE: "info",
  VIDEO: "warning",
  CAROUSEL: "muted",
  DPA: "muted",
  COLLECTION: "muted",
  OTHER: "muted",
};

function statusVariant(status: string | null | undefined): "success" | "muted" {
  return (status ?? "").toUpperCase() === "ACTIVE" ? "success" : "muted";
}

function isActive(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "ACTIVE";
}

type SortKey = "spend" | "roas" | "cpa" | "conversions" | "ctr";
type MetricKey = "spend" | "roas" | "cpa" | "purchases" | "ctr";
type TypeFilter = "ALL" | "IMAGE" | "VIDEO";
type StatusFilter = "ALL" | "ACTIVE" | "PAUSED";

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "spend", label: "Spend" },
  { value: "roas", label: "ROAS" },
  { value: "cpa", label: "CPA" },
  { value: "conversions", label: "Conversions" },
  { value: "ctr", label: "CTR" },
];

const METRIC_OPTIONS: ReadonlyArray<{ value: MetricKey; label: string }> = [
  { value: "spend", label: "Spend" },
  { value: "roas", label: "Meta ROAS" },
  { value: "cpa", label: "Meta CPA" },
  { value: "purchases", label: "Purchases" },
  { value: "ctr", label: "CTR" },
];

const RANGE_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 7, label: "7d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

const GRID_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// Ranking mode (CR2) — filter + sort by media-buyer decision intent. This is
// NOT a weighted/composite score: each mode is a membership predicate plus a
// deterministic ordering. The verdict guards and the median reasoning are
// mirrored from src/app/api/connections/[connectionId]/creative-report/route.ts.
// ---------------------------------------------------------------------------

// Ranking thresholds — copied verbatim from creative-report/route.ts
// (deliberately NOT imported this phase; route stays frozen). Keep in sync
// manually if the report's constants change.
const SCALE_MIN_SPEND_SHARE = 0.05;
const SCALE_ROAS_MEDIAN_MULT = 1.2;
const SCALE_MIN_PURCHASES = 3;
const KILL_MIN_SPEND = 250;

type RankMode = "manual" | "scale" | "efficient" | "spend_risk" | "fatigue";

const RANK_OPTIONS: ReadonlyArray<{ value: RankMode; label: string }> = [
  { value: "manual", label: "Manual sort" },
  { value: "scale", label: "Best to Scale" },
  { value: "efficient", label: "Efficient, Low Volume" },
  { value: "spend_risk", label: "High Spend Risk" },
  { value: "fatigue", label: "Fatigue Risk" },
];

type ActiveRankMode = Exclude<RankMode, "manual">;

/**
 * Membership test: does a creative belong to the given ranking mode? Mirrors
 * the verdict guards in creative-report/route.ts exactly. `spendShare` is the
 * creative's share of total grid-window spend (precomputed by the caller from
 * the unfiltered spenders population), and `fatigued` is the copied
 * isFatigued() result over the same grid window. `_totalSpend` is part of the
 * documented signature but unused here — the share is already supplied.
 */
function isInRankMode(
  mode: ActiveRankMode,
  agg: Aggregate,
  spendShare: number,
  fatigued: boolean,
  _totalSpend: number,
  medianRoas: number,
): boolean {
  const { roas, spend, purchases } = agg;
  switch (mode) {
    case "scale":
      return (
        (spendShare >= SCALE_MIN_SPEND_SHARE && roas > medianRoas) ||
        (medianRoas > 0 &&
          roas >= medianRoas * SCALE_ROAS_MEDIAN_MULT &&
          purchases >= SCALE_MIN_PURCHASES)
      );
    case "efficient":
      return (
        medianRoas > 0 &&
        roas >= medianRoas * SCALE_ROAS_MEDIAN_MULT &&
        purchases >= SCALE_MIN_PURCHASES &&
        spendShare < SCALE_MIN_SPEND_SHARE
      );
    case "spend_risk":
      return spend >= KILL_MIN_SPEND && (purchases === 0 || roas < medianRoas);
    case "fatigue":
      return fatigued === true;
  }
}

/**
 * Deterministic ordering within a ranking mode. Each comparison ends in an
 * `id.localeCompare` tie-break so the order is stable across renders.
 */
function compareInRankMode(
  mode: ActiveRankMode,
  a: { id: string; agg: Aggregate },
  b: { id: string; agg: Aggregate },
): number {
  const tie = a.id.localeCompare(b.id);
  switch (mode) {
    case "scale":
      // ROAS desc, then spend desc.
      return b.agg.roas - a.agg.roas || b.agg.spend - a.agg.spend || tie;
    case "efficient":
      // ROAS desc, then purchases desc.
      return (
        b.agg.roas - a.agg.roas || b.agg.purchases - a.agg.purchases || tie
      );
    case "spend_risk":
      // Spend desc, then ROAS ascending (worst ROAS first).
      return b.agg.spend - a.agg.spend || a.agg.roas - b.agg.roas || tie;
    case "fatigue":
      // Frequency desc, then id.
      return b.agg.frequency - a.agg.frequency || tie;
  }
}

// ---------------------------------------------------------------------------
// Small UI bits
// ---------------------------------------------------------------------------

const chipActive = "rounded bg-secondary px-2 py-1 font-medium text-foreground";
const chipIdle =
  "rounded px-2 py-1 text-muted-foreground hover:text-foreground transition-colors";

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-md bg-secondary/40 px-2 py-1'>
      <p className='text-[9px] uppercase tracking-wider text-muted-foreground'>
        {label}
      </p>
      <p className='text-[11px] font-semibold text-foreground'>{value}</p>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className='flex items-center justify-between gap-4 border-b border-border/40 py-2 text-sm last:border-0'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='text-right font-medium text-foreground'>{value}</span>
    </div>
  );
}

/** Visible, click-to-copy post/creative ID (uses the browser clipboard). */
function PostIdRow({ postId }: { postId: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    try {
      void navigator.clipboard?.writeText(postId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };
  return (
    <button
      type='button'
      onClick={copy}
      title='Copy post ID'
      className='mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground'>
      <span>Post ID · {postId}</span>
      <span className='text-[10px] uppercase tracking-wider'>
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function AnalyticCard({
  label,
  item,
  metric,
  accent,
}: {
  label: string;
  item: CreativeItem | undefined;
  metric: string;
  accent: "good" | "bad" | "neutral";
}) {
  const color =
    accent === "good"
      ? "text-emerald-400"
      : accent === "bad"
        ? "text-red-400"
        : "text-foreground";
  return (
    <Card className='p-4'>
      <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
        {label}
      </p>
      {item ? (
        <>
          <p
            className='mt-2 truncate text-sm font-medium text-foreground'
            title={item.name}>
            {item.name}
          </p>
          <p className={`mt-1 text-lg font-semibold ${color}`}>{metric}</p>
        </>
      ) : (
        <p className='mt-2 text-sm text-muted-foreground'>—</p>
      )}
    </Card>
  );
}

function GradientThumb({
  seed,
  className,
}: {
  seed: string;
  className?: string;
}) {
  const hue = Math.abs(
    seed.split("").reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7),
  );
  const a = hue % 360;
  const b = (a + 60) % 360;
  return (
    <div
      className={cn(
        "flex items-center justify-center text-xs text-white/70",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${a} 60% 45%), hsl(${b} 60% 35%))`,
      }}>
      No preview
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spend + ROAS sparkline (excludes the 2 most recent data days)
// ---------------------------------------------------------------------------

function Sparkline({
  daily,
  currency,
}: {
  daily: CreativeDailyPoint[];
  currency: string;
}) {
  const points = daily
    .filter((p) => p.spend > 0 || p.impressions > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  // Exclude the 2 most recent data days (Meta back-fills late conversions).
  const trimmed = points.slice(0, Math.max(0, points.length - 2));
  if (trimmed.length < 2) return null;
  const data = trimmed.map((p) => ({
    date: p.date,
    spend: p.spend,
    roas: p.spend > 0 ? p.conversionValue / p.spend : 0,
  }));
  return (
    <div className='h-24 w-full'>
      <ResponsiveContainer width='100%' height='100%'>
        <ComposedChart
          data={data}
          margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray='3 3' vertical={false} />
          <XAxis
            dataKey='date'
            tickFormatter={(v) => format(parseISO(v as string), "M/d")}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 9 }}
            minTickGap={20}
          />
          <YAxis yAxisId='spend' hide />
          <YAxis yAxisId='roas' orientation='right' hide />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 11,
            }}
            labelFormatter={(v) => format(parseISO(v as string), "MMM d, yyyy")}
            formatter={(value: number, name) =>
              name === "spend"
                ? [formatCurrency(value, currency), "Spend"]
                : [formatMultiplier(value), "Meta ROAS"]
            }
          />
          <Area
            yAxisId='spend'
            type='monotone'
            dataKey='spend'
            stroke='hsl(var(--primary))'
            strokeWidth={1.5}
            fill='hsl(var(--primary))'
            fillOpacity={0.12}
          />
          <Line
            yAxisId='roas'
            type='monotone'
            dataKey='roas'
            stroke='hsl(var(--success))'
            strokeWidth={1.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function CreativeDrawer({
  item,
  currency,
  onOpenChange,
}: {
  item: CreativeItem | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [rangeDays, setRangeDays] = React.useState(30);
  const [notes, setNotes] = React.useState("");

  // Reset range and load locally-stored notes whenever a new creative opens.
  React.useEffect(() => {
    if (!item) return;
    setRangeDays(30);
    try {
      setNotes(window.localStorage.getItem(`creative-notes:${item.id}`) ?? "");
    } catch {
      setNotes("");
    }
  }, [item]);

  const handleNotesChange = (value: string) => {
    setNotes(value);
    if (!item) return;
    try {
      window.localStorage.setItem(`creative-notes:${item.id}`, value);
    } catch {
      /* ignore quota / private-mode errors */
    }
  };

  const reference = item ? latestDate([item]) : null;
  const windowed = item
    ? withinWindow(item.daily, cutoffFor(reference, rangeDays))
    : [];
  const agg = aggregate(windowed);

  const launch = item?.launchDate
    ? format(parseISO(item.launchDate), "MMM d, yyyy")
    : "—";

  return (
    <Sheet open={item !== null} onOpenChange={onOpenChange}>
      <SheetContent className='gap-0 p-0'>
        {item && (
          <>
            {/* Header */}
            <div className='border-b border-border/60 p-5 pr-12'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={TYPE_VARIANT[item.type]}>
                  {item.type.toLowerCase()}
                </Badge>
                {item.status && (
                  <Badge variant={statusVariant(item.status)} withDot>
                    {item.status.toLowerCase()}
                  </Badge>
                )}
              </div>
              <SheetTitle className='mt-2 truncate' title={item.name}>
                {item.name}
              </SheetTitle>
              {item.adPlatformId && (
                <p className='mt-0.5 text-xs text-muted-foreground'>
                  Ad ID · {item.adPlatformId}
                </p>
              )}
              {item.postId && <PostIdRow postId={item.postId} />}
              <div className='mt-3 flex flex-wrap items-center gap-3'>
                <div className='flex items-center gap-1 text-xs'>
                  <span className='text-muted-foreground'>Range</span>
                  {RANGE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type='button'
                      onClick={() => setRangeDays(o.value)}
                      className={rangeDays === o.value ? chipActive : chipIdle}>
                      {o.label}
                    </button>
                  ))}
                </div>
                {item.reviewUrl && (
                  <a
                    href={item.reviewUrl}
                    target='_blank'
                    rel='noreferrer'
                    className={cn(buttonVariants({ size: "sm" }), "ml-auto")}>
                    {item.hasRealPostPreview
                      ? "Open Preview in Meta"
                      : "Review in Meta"}
                  </a>
                )}
              </div>
            </div>

            {/* Body */}
            <div className='flex-1 overflow-y-auto p-5'>
              <p className='mb-4 text-[11px] text-muted-foreground'>
                ROAS, CPA, purchases and conversion value are Meta-reported.
                Currency {currency}. Account timezone.
              </p>
              <Tabs defaultValue='overview'>
                <TabsList className='w-full'>
                  <TabsTrigger value='overview' className='flex-1'>
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value='performance' className='flex-1'>
                    Performance
                  </TabsTrigger>
                  <TabsTrigger value='details' className='flex-1'>
                    Details
                  </TabsTrigger>
                </TabsList>

                {/* Overview */}
                <TabsContent value='overview' className='mt-4 space-y-4'>
                  <div className='overflow-hidden rounded-lg border border-border/60'>
                    {item.preview ? (
                      <div className='relative'>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.preview}
                          alt={item.name}
                          className='max-h-72 w-full bg-black/20 object-contain'
                        />
                        {item.type === "VIDEO" && (
                          <div className='absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/30'>
                            <Play className='h-8 w-8 fill-white text-white' />
                            <span className='text-[10px] uppercase tracking-wider text-white/80'>
                              preview only
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <GradientThumb seed={item.id} className='h-56 w-full' />
                    )}
                  </div>
                  <div>
                    <DetailRow
                      label='Spend'
                      value={formatCurrency(agg.spend, currency)}
                    />
                    <DetailRow
                      label='Meta ROAS'
                      value={agg.spend > 0 ? formatMultiplier(agg.roas) : "—"}
                    />
                    <DetailRow
                      label='Meta CPA'
                      value={
                        agg.purchases > 0
                          ? formatCurrencyExact(agg.cpa, currency)
                          : "—"
                      }
                    />
                    <DetailRow
                      label='Purchases'
                      value={formatInt(agg.purchases)}
                    />
                    <DetailRow
                      label='Status'
                      value={
                        item.status ? (
                          <Badge variant={statusVariant(item.status)} withDot>
                            {item.status.toLowerCase()}
                          </Badge>
                        ) : (
                          "—"
                        )
                      }
                    />
                    <DetailRow label='Launch date' value={launch} />
                    <DetailRow
                      label='Campaign'
                      value={item.campaignName ?? "—"}
                    />
                    <DetailRow label='Ad set' value={item.adsetName ?? "—"} />
                    <DetailRow label='Ad' value={item.adName ?? "—"} />
                  </div>
                  {item.reviewUrl && (
                    <a
                      href={item.reviewUrl}
                      target='_blank'
                      rel='noreferrer'
                      className={cn(buttonVariants(), "w-full")}>
                      {item.hasRealPostPreview
                        ? "Open Preview in Meta"
                        : "Review in Meta"}
                    </a>
                  )}
                </TabsContent>

                {/* Performance */}
                <TabsContent value='performance' className='mt-4 space-y-4'>
                  {agg.hasData ? (
                    <>
                      <div>
                        <DetailRow
                          label='Spend'
                          value={formatCurrency(agg.spend, currency)}
                        />
                        <DetailRow
                          label='Purchases (Meta)'
                          value={formatInt(agg.purchases)}
                        />
                        <DetailRow
                          label='Conversion value (Meta)'
                          value={formatCurrency(agg.conversionValue, currency)}
                        />
                        <DetailRow
                          label='Meta ROAS'
                          value={
                            agg.spend > 0 ? formatMultiplier(agg.roas) : "—"
                          }
                        />
                        <DetailRow
                          label='Meta CPA'
                          value={
                            agg.purchases > 0
                              ? formatCurrencyExact(agg.cpa, currency)
                              : "—"
                          }
                        />
                        <DetailRow
                          label='CTR'
                          value={
                            agg.impressions > 0 ? formatPercent(agg.ctr) : "—"
                          }
                        />
                        <DetailRow
                          label='CPC'
                          value={
                            agg.clicks > 0
                              ? formatCurrencyExact(agg.cpc, currency)
                              : "—"
                          }
                        />
                        <DetailRow
                          label='CPM'
                          value={
                            agg.impressions > 0
                              ? formatCurrencyExact(agg.cpm, currency)
                              : "—"
                          }
                        />
                        <DetailRow
                          label='Frequency'
                          value={
                            agg.frequency > 0 ? agg.frequency.toFixed(2) : "—"
                          }
                        />
                        <DetailRow
                          label='Impressions'
                          value={formatInt(agg.impressions)}
                        />
                        <DetailRow
                          label='Clicks'
                          value={formatInt(agg.clicks)}
                        />
                      </div>
                      <div>
                        <p className='mb-1 text-[11px] uppercase tracking-wider text-muted-foreground'>
                          Spend &amp; Meta ROAS trend
                          <span className='ml-1 normal-case'>
                            (excludes 2 most recent days)
                          </span>
                        </p>
                        <Sparkline daily={item.daily} currency={currency} />
                      </div>
                    </>
                  ) : (
                    <p className='py-8 text-center text-sm text-muted-foreground'>
                      No performance data in this range.
                    </p>
                  )}
                </TabsContent>

                {/* Details */}
                <TabsContent value='details' className='mt-4 space-y-5'>
                  {(item.headline || item.bodyText || item.callToAction) && (
                    <div>
                      <p className='mb-2 text-[11px] uppercase tracking-wider text-muted-foreground'>
                        Creative copy
                      </p>
                      {item.headline && (
                        <DetailRow label='Headline' value={item.headline} />
                      )}
                      {item.bodyText && (
                        <DetailRow
                          label='Primary text'
                          value={
                            <span className='whitespace-pre-wrap text-left'>
                              {item.bodyText}
                            </span>
                          }
                        />
                      )}
                      {item.callToAction && (
                        <DetailRow
                          label='Call to action'
                          value={item.callToAction}
                        />
                      )}
                    </div>
                  )}
                  <div>
                    <p className='mb-2 text-[11px] uppercase tracking-wider text-muted-foreground'>
                      Linked ads
                    </p>
                    {item.linkedAds && item.linkedAds.length > 0 ? (
                      <div className='space-y-2'>
                        {item.linkedAds.map((ad) => (
                          <div
                            key={ad.id}
                            className='rounded-md border border-border/40 p-2'>
                            <div className='flex items-center justify-between gap-2'>
                              <span
                                className='truncate text-sm font-medium text-foreground'
                                title={ad.name ?? undefined}>
                                {ad.name ?? "—"}
                              </span>
                              {ad.effectiveStatus && (
                                <Badge
                                  variant={statusVariant(ad.effectiveStatus)}
                                  withDot>
                                  {isActive(ad.effectiveStatus)
                                    ? "Active"
                                    : "Paused"}
                                </Badge>
                              )}
                            </div>
                            <p className='mt-0.5 truncate text-[11px] text-muted-foreground'>
                              {[ad.campaignName, ad.adsetName]
                                .filter(Boolean)
                                .join(" · ") || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <>
                        <DetailRow
                          label='Campaign'
                          value={item.campaignName ?? "—"}
                        />
                        <DetailRow
                          label='Ad set'
                          value={item.adsetName ?? "—"}
                        />
                        <DetailRow label='Ad' value={item.adName ?? "—"} />
                        {item.adPlatformId && (
                          <DetailRow label='Ad ID' value={item.adPlatformId} />
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor='creative-notes'
                      className='mb-2 block text-[11px] uppercase tracking-wider text-muted-foreground'>
                      Notes (saved locally in this browser)
                    </label>
                    <textarea
                      id='creative-notes'
                      value={notes}
                      onChange={(e) => handleNotesChange(e.target.value)}
                      rows={4}
                      placeholder='Add a private note about this creative…'
                      className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function CreativeCard({
  item,
  agg,
  currency,
  metrics,
  onOpen,
}: {
  item: CreativeItem;
  agg: Aggregate;
  currency: string;
  metrics: ReadonlySet<MetricKey>;
  onOpen: () => void;
}) {
  const allChips: Array<{ key: MetricKey; label: string; value: string }> = [
    {
      key: "spend",
      label: "Spend",
      value: formatCurrency(agg.spend, currency),
    },
    {
      key: "roas",
      label: "Meta ROAS",
      value: agg.spend > 0 ? formatMultiplier(agg.roas) : "—",
    },
    {
      key: "cpa",
      label: "Meta CPA",
      value: agg.purchases > 0 ? formatCurrencyExact(agg.cpa, currency) : "—",
    },
    {
      key: "purchases",
      label: "Purchases",
      value: formatInt(agg.purchases),
    },
    {
      key: "ctr",
      label: "CTR",
      value: agg.impressions > 0 ? formatPercent(agg.ctr) : "—",
    },
  ];
  const chips = allChips.filter((c) => metrics.has(c.key));

  return (
    <Card className='flex flex-col overflow-hidden'>
      {/* Media */}
      <button
        type='button'
        onClick={onOpen}
        className='group relative block aspect-[4/3] w-full overflow-hidden bg-black/20 text-left'>
        {item.preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.preview}
            alt={item.name}
            className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-105'
          />
        ) : (
          <GradientThumb seed={item.id} className='h-full w-full' />
        )}
        {/* Video overlay */}
        {item.type === "VIDEO" && (
          <div className='absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/25 opacity-90'>
            <Play className='h-9 w-9 fill-white text-white drop-shadow' />
            <span className='rounded-full bg-black/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/90'>
              preview only
            </span>
          </div>
        )}
        {/* Badges overlaid bottom-left */}
        <div className='absolute bottom-2 left-2 flex items-center gap-1.5'>
          <Badge variant={TYPE_VARIANT[item.type]}>
            {item.type === "VIDEO" ? "Video" : "Image"}
          </Badge>
          {item.status && (
            <Badge variant={statusVariant(item.status)} withDot>
              {isActive(item.status) ? "Active" : "Paused"}
            </Badge>
          )}
        </div>
      </button>

      {/* Body */}
      <div className='flex flex-1 flex-col p-3'>
        <button
          type='button'
          onClick={onOpen}
          className='truncate text-left text-sm font-medium text-foreground hover:underline'
          title={item.name}>
          {item.name}
        </button>
        <p className='mt-0.5 truncate text-[11px] text-muted-foreground'>
          {[item.campaignName, item.adsetName].filter(Boolean).join(" · ") ||
            "—"}
        </p>

        {agg.hasData ? (
          chips.length > 0 && (
            <div className='mt-3 grid grid-cols-3 gap-1.5'>
              {chips.map((c) => (
                <MetricChip key={c.key} label={c.label} value={c.value} />
              ))}
            </div>
          )
        ) : (
          <p className='mt-3 rounded-md bg-secondary/40 px-2 py-2 text-center text-[11px] text-muted-foreground'>
            No performance data yet
          </p>
        )}

        <div className='mt-auto pt-3'>
          {item.reviewUrl ? (
            <a
              href={item.reviewUrl}
              target='_blank'
              rel='noreferrer'
              onClick={(e) => e.stopPropagation()}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "w-full",
              )}>
              {item.hasRealPostPreview
                ? "Open Preview in Meta"
                : "Review in Meta"}
            </a>
          ) : (
            <button
              type='button'
              onClick={onOpen}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "w-full",
              )}>
              View details
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function CreativesView({
  creatives,
  currency,
}: {
  creatives: CreativeItem[];
  currency: string;
}) {
  const [sortKey, setSortKey] = React.useState<SortKey>("spend");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [rankMode, setRankMode] = React.useState<RankMode>("manual");
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("ALL");
  const [statusFilter, setStatusFilter] =
    React.useState<StatusFilter>("ACTIVE");
  const [metrics, setMetrics] = React.useState<ReadonlySet<MetricKey>>(
    () => new Set<MetricKey>(["spend", "roas", "cpa", "purchases", "ctr"]),
  );
  const [minRoas, setMinRoas] = React.useState("");
  const [minSpend, setMinSpend] = React.useState("");
  const [minCtr, setMinCtr] = React.useState("");
  const [selected, setSelected] = React.useState<CreativeItem | null>(null);

  const reference = React.useMemo(() => latestDate(creatives), [creatives]);
  const gridCutoff = React.useMemo(
    () => cutoffFor(reference, GRID_WINDOW_DAYS),
    [reference],
  );

  // Per-creative aggregate over the grid window (last 30 days).
  const aggById = React.useMemo(() => {
    const m = new Map<string, Aggregate>();
    for (const c of creatives) {
      m.set(c.id, aggregate(withinWindow(c.daily, gridCutoff)));
    }
    return m;
  }, [creatives, gridCutoff]);

  const hasAnyInsights = React.useMemo(
    () => creatives.some((c) => aggById.get(c.id)?.hasData),
    [creatives, aggById],
  );

  // Ranking baseline — total spend + median ROAS over ALL creatives that spent
  // in the grid window (the same `withSpend` population the KPI strip uses),
  // computed BEFORE any type/status/threshold filter. This must never be the
  // filtered/visible set, or the thresholds would drift with the active view.
  const { totalSpend, medianRoas } = React.useMemo(() => {
    const withSpend = creatives.filter(
      (c) => (aggById.get(c.id)?.spend ?? 0) > 0,
    );
    const total = withSpend.reduce(
      (acc, c) => acc + (aggById.get(c.id)?.spend ?? 0),
      0,
    );
    // Median ROAS across positive-ROAS spenders only. Zero-ROAS spenders are
    // excluded on purpose: in a quiet wind-down window where most creatives
    // have ROAS 0, including them would drag the median to exactly 0, which
    // makes the SCALE_ROAS_MEDIAN_MULT multiplier meaningless and trips the
    // medianRoas > 0 guard so the efficiency path never fires. If the positive
    // subset is empty, medianRoas stays 0. (Mirrors creative-report/route.ts.)
    const roasSorted = withSpend
      .map((c) => aggById.get(c.id)!.roas)
      .filter((roas) => roas > 0)
      .sort((a, b) => a - b);
    const median =
      roasSorted.length === 0
        ? 0
        : roasSorted.length % 2 === 1
          ? roasSorted[(roasSorted.length - 1) / 2]
          : (roasSorted[roasSorted.length / 2 - 1] +
              roasSorted[roasSorted.length / 2]) /
            2;
    return { totalSpend: total, medianRoas: median };
  }, [creatives, aggById]);

  // KPI strip — over creatives that actually spent in the window.
  const kpis = React.useMemo(() => {
    const withSpend = creatives.filter(
      (c) => (aggById.get(c.id)?.spend ?? 0) > 0,
    );
    const get = (c: CreativeItem) => aggById.get(c.id)!;
    const bestRoas = withSpend
      .filter((c) => get(c).roas > 0)
      .sort((a, b) => get(b).roas - get(a).roas || a.id.localeCompare(b.id))[0];
    const mostConv = withSpend
      .filter((c) => get(c).purchases > 0)
      .sort(
        (a, b) =>
          get(b).purchases - get(a).purchases || a.id.localeCompare(b.id),
      )[0];
    const highestSpend = withSpend
      .slice()
      .sort(
        (a, b) => get(b).spend - get(a).spend || a.id.localeCompare(b.id),
      )[0];
    const worstRoas = withSpend
      .slice()
      .sort((a, b) => get(a).roas - get(b).roas || a.id.localeCompare(b.id))[0];
    // Fatigue: driven by the copied stored-ctr/frequency trend over the SAME
    // grid window as the cards, not a frequency>=3 gate. Deterministic pick:
    // worst (highest avg) frequency first, then asset id ascending.
    const fatigue = withSpend
      .filter((c) => isFatigued(withinWindow(c.daily, gridCutoff)))
      .sort(
        (a, b) =>
          get(b).frequency - get(a).frequency || a.id.localeCompare(b.id),
      )[0];
    return { bestRoas, mostConv, highestSpend, worstRoas, fatigue };
  }, [creatives, aggById, gridCutoff]);

  // Filtering + sorting.
  const visible = React.useMemo(() => {
    const roasT = parseFloat(minRoas);
    const spendT = parseFloat(minSpend);
    const ctrT = parseFloat(minCtr); // entered as percent
    const filtered = creatives.filter((c) => {
      if (typeFilter !== "ALL" && c.type !== typeFilter) return false;
      if (statusFilter === "ACTIVE" && !isActive(c.status)) return false;
      if (statusFilter === "PAUSED" && isActive(c.status)) return false;
      const a = aggById.get(c.id)!;
      if (!Number.isNaN(roasT) && a.roas < roasT) return false;
      if (!Number.isNaN(spendT) && a.spend < spendT) return false;
      if (!Number.isNaN(ctrT) && a.ctr * 100 < ctrT) return false;
      return true;
    });

    // Ranking mode overrides the manual sort: after the existing type/status/
    // threshold filters, keep only members of the active mode, then order by
    // that mode's deterministic rule. The manual sortKey/sortDir controls are
    // ignored (not deleted) while a ranking mode is active.
    if (rankMode !== "manual") {
      const members = filtered.filter((c) => {
        const a = aggById.get(c.id)!;
        const spendShare = totalSpend > 0 ? a.spend / totalSpend : 0;
        const fatigued = isFatigued(withinWindow(c.daily, gridCutoff));
        return isInRankMode(
          rankMode,
          a,
          spendShare,
          fatigued,
          totalSpend,
          medianRoas,
        );
      });
      return members
        .slice()
        .sort((x, y) =>
          compareInRankMode(
            rankMode,
            { id: x.id, agg: aggById.get(x.id)! },
            { id: y.id, agg: aggById.get(y.id)! },
          ),
        );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    const value = (c: CreativeItem): number => {
      const a = aggById.get(c.id)!;
      switch (sortKey) {
        case "roas":
          return a.roas;
        case "cpa":
          return a.cpa;
        case "conversions":
          return a.purchases;
        case "ctr":
          return a.ctr;
        default:
          return a.spend;
      }
    };
    return filtered.slice().sort((a, b) => (value(a) - value(b)) * dir);
  }, [
    creatives,
    aggById,
    gridCutoff,
    typeFilter,
    statusFilter,
    minRoas,
    minSpend,
    minCtr,
    sortKey,
    sortDir,
    rankMode,
    totalSpend,
    medianRoas,
  ]);

  const toggleMetric = (key: MetricKey) => {
    setMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least one chip
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const thresholdInput =
    "h-7 w-16 rounded border border-border bg-background px-1.5 text-right text-xs";

  return (
    <div className='space-y-6'>
      {/* KPI strip */}
      {hasAnyInsights && (
        <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
          <AnalyticCard
            label='Best ROAS'
            item={kpis.bestRoas}
            metric={
              kpis.bestRoas
                ? formatMultiplier(aggById.get(kpis.bestRoas.id)!.roas)
                : ""
            }
            accent='good'
          />
          <AnalyticCard
            label='Most conversions'
            item={kpis.mostConv}
            metric={
              kpis.mostConv
                ? formatInt(aggById.get(kpis.mostConv.id)!.purchases)
                : ""
            }
            accent='good'
          />
          <AnalyticCard
            label='Highest spend'
            item={kpis.highestSpend}
            metric={
              kpis.highestSpend
                ? formatCurrency(
                    aggById.get(kpis.highestSpend.id)!.spend,
                    currency,
                  )
                : ""
            }
            accent='neutral'
          />
          <AnalyticCard
            label='Worst ROAS'
            item={kpis.worstRoas}
            metric={
              kpis.worstRoas
                ? formatMultiplier(aggById.get(kpis.worstRoas.id)!.roas)
                : ""
            }
            accent='bad'
          />
          <AnalyticCard
            label='Fatigue risk'
            item={kpis.fatigue}
            metric={
              kpis.fatigue
                ? `${aggById.get(kpis.fatigue.id)!.frequency.toFixed(2)} freq`
                : ""
            }
            accent='bad'
          />
        </div>
      )}

      {/* Controls */}
      <div className='space-y-3 rounded-lg border border-border/60 bg-card/40 p-3 text-xs'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          {/* Rank */}
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>Rank</span>
            {RANK_OPTIONS.map((o) => (
              <button
                key={o.value}
                type='button'
                onClick={() => setRankMode(o.value)}
                className={rankMode === o.value ? chipActive : chipIdle}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          {/* Sort */}
          <div
            className={cn(
              "flex items-center gap-1.5",
              rankMode !== "manual" && "opacity-60",
            )}>
            <span className='text-muted-foreground'>Sort</span>
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type='button'
                onClick={() => setSortKey(o.value)}
                className={sortKey === o.value ? chipActive : chipIdle}>
                {o.label}
              </button>
            ))}
            <button
              type='button'
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className={chipIdle}
              title={sortDir === "asc" ? "Ascending" : "Descending"}>
              {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
            </button>
            {rankMode !== "manual" && (
              <span className='text-muted-foreground'>
                (overridden by ranking)
              </span>
            )}
          </div>

          {/* Type */}
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>Type</span>
            {(["ALL", "IMAGE", "VIDEO"] as const).map((t) => (
              <button
                key={t}
                type='button'
                onClick={() => setTypeFilter(t)}
                className={typeFilter === t ? chipActive : chipIdle}>
                {t === "ALL" ? "All" : t === "IMAGE" ? "Image" : "Video"}
              </button>
            ))}
          </div>

          {/* Status */}
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>Status</span>
            {(["ALL", "ACTIVE", "PAUSED"] as const).map((s) => (
              <button
                key={s}
                type='button'
                onClick={() => setStatusFilter(s)}
                className={statusFilter === s ? chipActive : chipIdle}>
                {s === "ALL" ? "All" : s === "ACTIVE" ? "Active" : "Paused"}
              </button>
            ))}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/40 pt-3'>
          {/* Metric display */}
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>Show</span>
            {METRIC_OPTIONS.map((o) => (
              <button
                key={o.value}
                type='button'
                onClick={() => toggleMetric(o.value)}
                className={metrics.has(o.value) ? chipActive : chipIdle}>
                {o.label}
              </button>
            ))}
          </div>

          {/* Threshold filters */}
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>ROAS ≥</span>
            <Input
              type='number'
              inputMode='decimal'
              value={minRoas}
              onChange={(e) => setMinRoas(e.target.value)}
              placeholder='0'
              className={thresholdInput}
            />
          </div>
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>Spend ≥</span>
            <Input
              type='number'
              inputMode='decimal'
              value={minSpend}
              onChange={(e) => setMinSpend(e.target.value)}
              placeholder='0'
              className={thresholdInput}
            />
          </div>
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground'>CTR ≥ %</span>
            <Input
              type='number'
              inputMode='decimal'
              value={minCtr}
              onChange={(e) => setMinCtr(e.target.value)}
              placeholder='0'
              className={thresholdInput}
            />
          </div>
          {(minRoas || minSpend || minCtr) && (
            <button
              type='button'
              onClick={() => {
                setMinRoas("");
                setMinSpend("");
                setMinCtr("");
              }}
              className={chipIdle}>
              Clear thresholds
            </button>
          )}
        </div>
      </div>

      {/* Missing-insights notice */}
      {!hasAnyInsights && (
        <Card className='border-amber-500/30 bg-amber-500/[0.04] p-4'>
          <p className='text-sm text-amber-300'>
            Creatives synced, but ad-level insights are not available yet for
            this window.
          </p>
        </Card>
      )}

      {/* Grid */}
      {visible.length === 0 ? (
        <EmptyState
          title='No creatives match these filters'
          description='Try clearing the type, status or threshold filters.'
        />
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {visible.map((c) => (
            <CreativeCard
              key={c.id}
              item={c}
              agg={aggById.get(c.id)!}
              currency={currency}
              metrics={metrics}
              onOpen={() => setSelected(c)}
            />
          ))}
        </div>
      )}

      <CreativeDrawer
        item={selected}
        currency={currency}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

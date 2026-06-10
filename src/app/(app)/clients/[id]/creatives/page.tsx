import { notFound } from "next/navigation";
import Link from "next/link";
import { subDays } from "date-fns";
import type { CreativeType } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import {
  formatCurrency,
  formatCurrencyExact,
  formatInt,
  formatMultiplier,
  formatPercent,
} from "@/lib/format";

export const dynamic = "force-dynamic";

type SortField = "spend" | "roas" | "conversions" | "ctr";
type TypeFilter = "ALL" | "IMAGE" | "VIDEO";
type StatusFilter = "ALL" | "ACTIVE" | "PAUSED";

interface PageProps {
  params: { id: string };
  searchParams: {
    sort?: string;
    type?: string;
    status?: string;
  };
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function parseSort(raw: string | undefined): SortField {
  if (raw === "roas" || raw === "conversions" || raw === "ctr") return raw;
  return "spend";
}

function parseType(raw: string | undefined): TypeFilter {
  if (raw === "IMAGE" || raw === "VIDEO") return raw;
  return "ALL";
}

function parseStatus(raw: string | undefined): StatusFilter {
  if (raw === "ACTIVE" || raw === "PAUSED") return raw;
  return "ALL";
}

// Best-effort deep link into Meta Ads Manager for reviewing an ad's creative
// in its native environment. Not an API call — just a shortcut URL.
function buildMetaAdReviewUrl(accountId: string, adId: string): string {
  const numericAccountId = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(numericAccountId)}&selected_ad_ids=${encodeURIComponent(adId)}`;
}

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

function GradientThumb({ seed }: { seed: string }) {
  // Deterministic gradient fallback when no thumbnail exists.
  const hue = Math.abs(
    seed.split("").reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7),
  );
  const a = hue % 360;
  const b = (a + 60) % 360;
  return (
    <div
      className='flex h-36 w-full items-center justify-center rounded-md text-xs text-white/70'
      style={{
        background: `linear-gradient(135deg, hsl(${a} 60% 45%), hsl(${b} 60% 35%))`,
      }}>
      No preview
    </div>
  );
}

interface CreativePerf {
  id: string;
  name: string;
  type: CreativeType;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  headline: string | null;
  status: string | null;
  campaignName: string | null;
  adName: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
  cpa: number;
  roas: number;
  hasData: boolean;
  reviewUrl: string | null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-medium text-foreground'>{value}</span>
    </div>
  );
}

function AnalyticCard({
  label,
  item,
  metric,
  accent,
}: {
  label: string;
  item: CreativePerf | undefined;
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

export default async function ClientCreativesPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(params.id)) {
    notFound();
  }

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      industry: true,
      reportingCurrency: true,
    },
  });
  if (!client) notFound();

  const currency = client.reportingCurrency;
  const sort = parseSort(searchParams.sort);
  const typeFilter = parseType(searchParams.type);
  const statusFilter = parseStatus(searchParams.status);

  const connections = await db.adAccountConnection.findMany({
    where: { clientId: client.id },
    select: { id: true, platformAccountId: true },
  });
  const connectionIds = connections.map((c) => c.id);
  const accountIdByConnection = new Map(
    connections.map((c) => [c.id, c.platformAccountId]),
  );

  const creatives = await db.creative.findMany({
    where: { adAccountConnectionId: { in: connectionIds } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      thumbnailUrl: true,
      imageUrl: true,
      headline: true,
      adAccountConnectionId: true,
      ads: {
        select: {
          id: true,
          name: true,
          platformId: true,
          effectiveStatus: true,
          adSet: { select: { campaign: { select: { name: true } } } },
        },
      },
    },
  });

  // Ad-level insights for the last 30 days, aggregated per ad.
  const adIds = creatives.flatMap((c) => c.ads.map((a) => a.id));
  const insightsByAd = new Map<
    string,
    {
      spend: number;
      impressions: number;
      clicks: number;
      conversions: number;
      conversionValue: number;
      freqSum: number;
      freqCount: number;
    }
  >();
  if (adIds.length > 0) {
    const rows = await db.insightsDaily.findMany({
      where: {
        entityType: "AD",
        entityId: { in: adIds },
        date: { gte: subDays(new Date(), 30) },
      },
      select: {
        entityId: true,
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
        conversionValue: true,
        frequency: true,
      },
    });
    for (const r of rows) {
      const cur = insightsByAd.get(r.entityId) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
        freqSum: 0,
        freqCount: 0,
      };
      cur.spend += num(r.spend);
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.conversions += r.conversions;
      cur.conversionValue += num(r.conversionValue);
      if (r.frequency !== null) {
        cur.freqSum += num(r.frequency);
        cur.freqCount += 1;
      }
      insightsByAd.set(r.entityId, cur);
    }
  }

  const hasAnyInsights = insightsByAd.size > 0;

  const perf: CreativePerf[] = creatives.map((cr) => {
    const primaryAd = cr.ads[0];
    let spend = 0;
    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    let conversionValue = 0;
    let freqSum = 0;
    let freqCount = 0;
    for (const ad of cr.ads) {
      const agg = insightsByAd.get(ad.id);
      if (!agg) continue;
      spend += agg.spend;
      impressions += agg.impressions;
      clicks += agg.clicks;
      conversions += agg.conversions;
      conversionValue += agg.conversionValue;
      freqSum += agg.freqSum;
      freqCount += agg.freqCount;
    }
    const frequency = freqCount > 0 ? freqSum / freqCount : 0;
    // Prefer a linked ad with spend in the 30-day window; else the first ad.
    const reviewAd =
      cr.ads.find(
        (ad) => ad.platformId && (insightsByAd.get(ad.id)?.spend ?? 0) > 0,
      ) ?? cr.ads[0];
    const accountId = accountIdByConnection.get(cr.adAccountConnectionId);
    const reviewUrl =
      reviewAd?.platformId && accountId
        ? buildMetaAdReviewUrl(accountId, reviewAd.platformId)
        : null;
    return {
      id: cr.id,
      name: cr.name,
      type: cr.type,
      thumbnailUrl: cr.thumbnailUrl,
      imageUrl: cr.imageUrl,
      headline: cr.headline,
      status: primaryAd?.effectiveStatus ?? null,
      campaignName: primaryAd?.adSet?.campaign?.name ?? null,
      adName: primaryAd?.name ?? null,
      spend,
      impressions,
      clicks,
      conversions,
      conversionValue,
      frequency,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      cpa: conversions > 0 ? spend / conversions : 0,
      roas: spend > 0 ? conversionValue / spend : 0,
      hasData: impressions > 0 || spend > 0,
      reviewUrl,
    };
  });

  // Analytics over creatives that actually have spend.
  const withSpend = perf.filter((p) => p.spend > 0);
  const bestRoas = withSpend
    .filter((p) => p.roas > 0)
    .sort((a, b) => b.roas - a.roas)[0];
  const bestConversions = withSpend
    .filter((p) => p.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions)[0];
  const highestSpend = withSpend.slice().sort((a, b) => b.spend - a.spend)[0];
  // Worst: spending but weakest ROAS (or no return at all).
  const worst = withSpend.slice().sort((a, b) => a.roas - b.roas)[0];
  const fatigued = withSpend
    .filter((p) => p.frequency >= 3)
    .sort((a, b) => b.frequency - a.frequency)[0];

  // Filtering
  const filtered = perf.filter((p) => {
    if (typeFilter !== "ALL" && p.type !== typeFilter) return false;
    if (statusFilter !== "ALL") {
      const s = (p.status ?? "").toUpperCase();
      if (statusFilter === "ACTIVE" && s !== "ACTIVE") return false;
      if (statusFilter === "PAUSED" && s === "ACTIVE") return false;
    }
    return true;
  });

  // Sorting
  const sorted = filtered.slice().sort((a, b) => {
    switch (sort) {
      case "roas":
        return b.roas - a.roas;
      case "conversions":
        return b.conversions - a.conversions;
      case "ctr":
        return b.ctr - a.ctr;
      default:
        return b.spend - a.spend;
    }
  });

  const buildHref = (overrides: Partial<Record<string, string>>): string => {
    const sp = new URLSearchParams();
    const next = { sort, type: typeFilter, status: statusFilter, ...overrides };
    if (next.sort !== "spend") sp.set("sort", next.sort);
    if (next.type !== "ALL") sp.set("type", next.type);
    if (next.status !== "ALL") sp.set("status", next.status);
    const qs = sp.toString();
    return `/clients/${client.id}/creatives${qs ? `?${qs}` : ""}`;
  };

  const SORT_OPTIONS: ReadonlyArray<{ value: SortField; label: string }> = [
    { value: "spend", label: "Spend" },
    { value: "roas", label: "ROAS" },
    { value: "conversions", label: "Conversions" },
    { value: "ctr", label: "CTR" },
  ];
  const TYPE_OPTIONS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
    { value: "ALL", label: "All types" },
    { value: "IMAGE", label: "Image" },
    { value: "VIDEO", label: "Video" },
  ];
  const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> =
    [
      { value: "ALL", label: "All statuses" },
      { value: "ACTIVE", label: "Active" },
      { value: "PAUSED", label: "Paused" },
    ];

  const activeClass =
    "rounded bg-secondary px-2 py-1 font-medium text-foreground";
  const idleClass =
    "rounded px-2 py-1 text-muted-foreground hover:text-foreground";

  return (
    <div className='space-y-8'>
      {/* Header */}
      <div className='space-y-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {client.name}
          </h1>
          {client.industry && (
            <p className='mt-1 text-sm text-muted-foreground'>
              {client.industry}
            </p>
          )}
        </div>
        <ClientSubNav clientId={client.id} active='creatives' />
      </div>

      <div className='space-y-1'>
        <h2 className='text-xl font-semibold tracking-tight'>Creatives</h2>
        <p className='text-sm text-muted-foreground'>
          Ad-level performance for image and video assets — last 30 days.
        </p>
      </div>

      {creatives.length === 0 ? (
        <EmptyState
          title='No creatives synced yet'
          description='Run sync to import creatives.'
        />
      ) : (
        <>
          {/* Analytics */}
          {hasAnyInsights && (
            <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
              <AnalyticCard
                label='Best ROAS'
                item={bestRoas}
                metric={bestRoas ? formatMultiplier(bestRoas.roas) : ""}
                accent='good'
              />
              <AnalyticCard
                label='Most conversions'
                item={bestConversions}
                metric={
                  bestConversions ? formatInt(bestConversions.conversions) : ""
                }
                accent='good'
              />
              <AnalyticCard
                label='Highest spend'
                item={highestSpend}
                metric={
                  highestSpend
                    ? formatCurrency(highestSpend.spend, currency)
                    : ""
                }
                accent='neutral'
              />
              <AnalyticCard
                label='Worst ROAS'
                item={worst}
                metric={worst ? formatMultiplier(worst.roas) : ""}
                accent='bad'
              />
              <AnalyticCard
                label='Fatigue risk'
                item={fatigued}
                metric={
                  fatigued ? `${formatMultiplier(fatigued.frequency)} freq` : ""
                }
                accent='bad'
              />
            </div>
          )}

          {/* Controls */}
          <div className='flex flex-wrap items-center gap-4 text-xs'>
            <div className='flex items-center gap-1.5'>
              <span className='text-muted-foreground'>Sort</span>
              {SORT_OPTIONS.map((o) => (
                <Link
                  key={o.value}
                  href={buildHref({ sort: o.value })}
                  className={sort === o.value ? activeClass : idleClass}>
                  {o.label}
                </Link>
              ))}
            </div>
            <div className='flex items-center gap-1.5'>
              <span className='text-muted-foreground'>Type</span>
              {TYPE_OPTIONS.map((o) => (
                <Link
                  key={o.value}
                  href={buildHref({ type: o.value })}
                  className={typeFilter === o.value ? activeClass : idleClass}>
                  {o.label}
                </Link>
              ))}
            </div>
            <div className='flex items-center gap-1.5'>
              <span className='text-muted-foreground'>Status</span>
              {STATUS_OPTIONS.map((o) => (
                <Link
                  key={o.value}
                  href={buildHref({ status: o.value })}
                  className={
                    statusFilter === o.value ? activeClass : idleClass
                  }>
                  {o.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Insights-missing notice */}
          {!hasAnyInsights && (
            <Card className='border-amber-500/30 bg-amber-500/[0.04] p-4'>
              <p className='text-sm text-amber-300'>
                Creatives synced, but ad-level insights are not synced yet. Run
                sync to import performance data.
              </p>
            </Card>
          )}

          {/* Grid */}
          {sorted.length === 0 ? (
            <EmptyState
              title='No creatives match these filters'
              description='Try clearing the type or status filter.'
            />
          ) : (
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
              {sorted.map((cr) => {
                const preview = cr.thumbnailUrl ?? cr.imageUrl ?? null;
                return (
                  <Card key={cr.id} className='overflow-hidden p-3'>
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt={cr.name}
                        className='h-36 w-full rounded-md object-cover'
                      />
                    ) : (
                      <GradientThumb seed={cr.id} />
                    )}

                    <div className='mt-3 flex items-center gap-2'>
                      <Badge variant={TYPE_VARIANT[cr.type]}>
                        {cr.type.toLowerCase()}
                      </Badge>
                      {cr.status && (
                        <Badge variant={statusVariant(cr.status)} withDot>
                          {cr.status.toLowerCase()}
                        </Badge>
                      )}
                      {cr.frequency >= 3 && (
                        <Badge variant='destructive'>fatigue</Badge>
                      )}
                    </div>

                    <p
                      className='mt-2 truncate text-sm font-medium text-foreground'
                      title={cr.name}>
                      {cr.name}
                    </p>
                    {cr.headline && (
                      <p className='truncate text-xs text-muted-foreground'>
                        {cr.headline}
                      </p>
                    )}

                    <div className='mt-2 space-y-0.5 text-[11px] text-muted-foreground'>
                      {cr.campaignName && (
                        <p className='truncate'>Campaign · {cr.campaignName}</p>
                      )}
                      {cr.adName && (
                        <p className='truncate'>Ad · {cr.adName}</p>
                      )}
                    </div>

                    {cr.hasData ? (
                      <div className='mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border/40 pt-3 text-[11px]'>
                        <Metric
                          label='Spend'
                          value={formatCurrency(cr.spend, currency)}
                        />
                        <Metric
                          label='ROAS'
                          value={formatMultiplier(cr.roas)}
                        />
                        <Metric
                          label='CPA'
                          value={
                            cr.cpa > 0
                              ? formatCurrencyExact(cr.cpa, currency)
                              : "—"
                          }
                        />
                        <Metric
                          label='Conv'
                          value={formatInt(cr.conversions)}
                        />
                        <Metric
                          label='CTR'
                          value={
                            cr.impressions > 0 ? formatPercent(cr.ctr) : "—"
                          }
                        />
                        <Metric
                          label='CPC'
                          value={
                            cr.clicks > 0
                              ? formatCurrencyExact(cr.cpc, currency)
                              : "—"
                          }
                        />
                        <Metric
                          label='CPM'
                          value={
                            cr.impressions > 0
                              ? formatCurrencyExact(cr.cpm, currency)
                              : "—"
                          }
                        />
                        <Metric
                          label='Impr'
                          value={formatInt(cr.impressions)}
                        />
                      </div>
                    ) : (
                      <p className='mt-3 border-t border-border/40 pt-3 text-[11px] text-muted-foreground'>
                        No performance data yet.
                      </p>
                    )}

                    {cr.reviewUrl && (
                      <a
                        href={cr.reviewUrl}
                        target='_blank'
                        rel='noreferrer'
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "mt-3 w-full",
                        )}>
                        Review in Meta
                      </a>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

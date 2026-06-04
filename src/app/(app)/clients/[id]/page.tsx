import { notFound } from "next/navigation";
import {
  subDays,
  startOfMonth,
  getDaysInMonth,
  getDate,
  formatDistanceToNow,
} from "date-fns";
import type { TaskPriority } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { OverviewMetricCard } from "@/components/clients/overview-metric-card";
import { SpendRoasChart } from "@/components/dashboard/spend-roas-chart";
import {
  formatCurrency,
  formatCurrencyExact,
  formatInt,
  formatMultiplier,
  formatPercent,
  formatDelta,
} from "@/lib/format";

const priorityWeight: Record<TaskPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  MED: 2,
  LOW: 1,
};

const SEVERITY_VARIANT = {
  CRITICAL: "destructive",
  WARNING: "warning",
  INFO: "info",
} as const;

const PRIORITY_VARIANT = {
  URGENT: "destructive",
  HIGH: "destructive",
  MED: "warning",
  LOW: "muted",
} as const;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function pctChange(curr: number, prev: number): number | null {
  if (prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

function buildDelta(
  curr: number,
  prev: number,
  higherIsBetter: boolean,
): { value: string; positive: boolean } | null {
  const pc = pctChange(curr, prev);
  if (pc === null) return null;
  const positive = higherIsBetter ? pc >= 0 : pc <= 0;
  return { value: formatDelta(pc), positive };
}

interface PageProps {
  params: { id: string };
}

export default async function ClientOverviewPage({ params }: PageProps) {
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
      notes: true,
      monthlyBudget: true,
      minCpa: true,
      maxCpa: true,
      minRoas: true,
      reportingCurrency: true,
    },
  });
  if (!client) notFound();

  const currency = client.reportingCurrency;
  const monthlyBudget = client.monthlyBudget ? num(client.monthlyBudget) : null;
  const targetRoas = client.minRoas ? num(client.minRoas) : null;
  const targetCpa = client.maxCpa ? num(client.maxCpa) : null;

  const now = new Date();
  const d30 = subDays(now, 30);
  const d60 = subDays(now, 60);
  const monthStart = startOfMonth(now);

  const campaigns = await db.campaign.findMany({
    where: { adAccountConnection: { clientId: client.id } },
    select: { id: true, name: true, effectiveStatus: true },
  });
  const campaignIds = campaigns.map((c) => c.id);
  const campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));

  const [
    syncAgg,
    insights30,
    insightsPrev,
    mtd,
    dailyRows,
    perCampaignRows,
    alerts,
    tasks,
    recommendationCount,
  ] = await Promise.all([
    db.adAccountConnection.aggregate({
      where: { clientId: client.id },
      _max: { lastSyncedAt: true },
    }),
    db.insightsDaily.aggregate({
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d30 },
      },
      _sum: {
        spend: true,
        conversionValue: true,
        conversions: true,
        clicks: true,
        impressions: true,
      },
      _avg: { frequency: true },
    }),
    db.insightsDaily.aggregate({
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d60, lt: d30 },
      },
      _sum: {
        spend: true,
        conversionValue: true,
        conversions: true,
      },
    }),
    db.insightsDaily.aggregate({
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: monthStart },
      },
      _sum: { spend: true },
    }),
    db.insightsDaily.groupBy({
      by: ["date"],
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d30 },
      },
      _sum: { spend: true },
      orderBy: { date: "asc" },
    }),
    db.insightsDaily.groupBy({
      by: ["entityId"],
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d30 },
      },
      _sum: {
        spend: true,
        conversionValue: true,
        conversions: true,
      },
    }),
    db.alert.findMany({
      where: { clientId: client.id, status: "OPEN" },
      orderBy: { triggeredAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        severity: true,
        rule: true,
        triggeredAt: true,
      },
    }),
    db.task.findMany({
      where: { clientId: client.id, status: { in: ["TODO", "IN_PROGRESS"] } },
      orderBy: [{ createdAt: "desc" }],
      take: 25,
      select: {
        id: true,
        title: true,
        priority: true,
        status: true,
        rule: true,
        createdAt: true,
      },
    }),
    db.recommendation.count({
      where: { clientId: client.id, status: "PENDING" },
    }),
  ]);

  // Current period metrics
  const spend = num(insights30._sum.spend);
  const convValue = num(insights30._sum.conversionValue);
  const conversions = num(insights30._sum.conversions);
  const clicks = num(insights30._sum.clicks);
  const impressions = num(insights30._sum.impressions);
  const frequency = num(insights30._avg.frequency);

  const roas = spend > 0 ? convValue / spend : 0;
  const cpa = conversions > 0 ? spend / conversions : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const aov = conversions > 0 ? convValue / conversions : 0;

  // Previous period metrics
  const prevSpend = num(insightsPrev._sum.spend);
  const prevConvValue = num(insightsPrev._sum.conversionValue);
  const prevConversions = num(insightsPrev._sum.conversions);
  const prevRoas = prevSpend > 0 ? prevConvValue / prevSpend : 0;
  const prevCpa = prevConversions > 0 ? prevSpend / prevConversions : 0;

  // Budget pacing
  const mtdSpend = num(mtd._sum.spend);
  const daysInMonth = getDaysInMonth(now);
  const dayOfMonth = getDate(now);
  const projectedSpend =
    dayOfMonth > 0 ? (mtdSpend / dayOfMonth) * daysInMonth : 0;
  const expectedToDate =
    monthlyBudget !== null ? (monthlyBudget / daysInMonth) * dayOfMonth : null;

  type PaceState = "under" | "on" | "over" | "unknown";
  let paceState: PaceState = "unknown";
  if (expectedToDate !== null && expectedToDate > 0) {
    if (mtdSpend < expectedToDate * 0.9) paceState = "under";
    else if (mtdSpend > expectedToDate * 1.1) paceState = "over";
    else paceState = "on";
  }
  const paceLabel: Record<PaceState, string> = {
    under: "Under pace",
    on: "On pace",
    over: "Over pace",
    unknown: "No budget set",
  };

  // Per-campaign aggregation
  const campaignMetrics = perCampaignRows
    .map((row) => {
      const cSpend = num(row._sum.spend);
      const cConvValue = num(row._sum.conversionValue);
      const cConversions = num(row._sum.conversions);
      const cRoas = cSpend > 0 ? cConvValue / cSpend : 0;
      const cCpa = cConversions > 0 ? cSpend / cConversions : 0;
      const belowRoas = targetRoas !== null && cSpend > 0 && cRoas < targetRoas;
      const aboveCpa =
        targetCpa !== null && cConversions > 0 && cCpa > targetCpa;
      return {
        id: row.entityId,
        name: campaignNameById.get(row.entityId) ?? "Unknown campaign",
        spend: cSpend,
        roas: cRoas,
        cpa: cCpa,
        conversions: cConversions,
        needsAttention: belowRoas || aboveCpa,
      };
    })
    .filter((c) => c.spend > 0);

  const topCampaigns = campaignMetrics
    .slice()
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5);

  const attentionCampaigns = campaignMetrics
    .filter((c) => c.needsAttention)
    .sort((a, b) => b.spend - a.spend);

  // Status banner phrases
  const bannerPhrases: string[] = [];
  if (paceState === "under") bannerPhrases.push("Pacing under budget");
  else if (paceState === "over") bannerPhrases.push("Pacing over budget");
  else if (paceState === "on") bannerPhrases.push("On budget pace");
  if (targetRoas !== null && spend > 0) {
    bannerPhrases.push(
      roas < targetRoas ? "ROAS below target" : "ROAS on target",
    );
  }
  if (attentionCampaigns.length > 0) {
    bannerPhrases.push(
      `${attentionCampaigns.length} campaign${
        attentionCampaigns.length === 1 ? "" : "s"
      } need attention`,
    );
  }
  const bannerHasWarning =
    paceState === "over" ||
    paceState === "under" ||
    (targetRoas !== null && spend > 0 && roas < targetRoas) ||
    attentionCampaigns.length > 0;

  const lastSyncedAt = syncAgg._max.lastSyncedAt;

  const topTasks = tasks
    .slice()
    .sort((a, b) => {
      const dp = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (dp !== 0) return dp;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 5);

  const chartData = dailyRows.map((r) => ({
    date: r.date.toISOString(),
    spend: num(r._sum.spend),
  }));

  const spendSub =
    monthlyBudget !== null
      ? `${formatCurrency(mtdSpend, currency)} MTD · ${paceLabel[paceState]}`
      : "Last 30 days";

  const roasWarning = targetRoas !== null && spend > 0 && roas < targetRoas;
  const cpaWarning = targetCpa !== null && cpa > 0 && cpa > targetCpa;

  const diagnostics = [
    { label: "CTR", value: impressions > 0 ? formatPercent(ctr) : "—" },
    {
      label: "CPC",
      value: clicks > 0 ? formatCurrencyExact(cpc, currency) : "—",
    },
    {
      label: "CPM",
      value: impressions > 0 ? formatCurrencyExact(cpm, currency) : "—",
    },
    {
      label: "Frequency",
      value: frequency > 0 ? formatMultiplier(frequency) : "—",
    },
    { label: "AOV", value: aov > 0 ? formatCurrencyExact(aov, currency) : "—" },
  ];

  return (
    <div className='space-y-8'>
      {/* Header */}
      <div className='space-y-4'>
        <div className='flex flex-wrap items-start justify-between gap-4'>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>
              {client.name}
            </h1>
            <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground'>
              {client.industry && <span>{client.industry}</span>}
              {monthlyBudget !== null && (
                <span>Budget {formatCurrency(monthlyBudget, currency)}/mo</span>
              )}
              {targetRoas !== null && (
                <span>Target ROAS {formatMultiplier(targetRoas)}</span>
              )}
              {targetCpa !== null && (
                <span>
                  Target CPA {formatCurrencyExact(targetCpa, currency)}
                </span>
              )}
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>
            {lastSyncedAt
              ? `Last synced ${formatDistanceToNow(lastSyncedAt, {
                  addSuffix: true,
                })}`
              : "Never synced"}
          </p>
        </div>

        <ClientSubNav clientId={client.id} active='' />
      </div>

      {/* Status banner */}
      {bannerPhrases.length > 0 && (
        <div
          className={
            bannerHasWarning
              ? "rounded-lg border border-amber-500/30 bg-amber-500/[0.04] px-4 py-3"
              : "rounded-lg border border-border bg-secondary/40 px-4 py-3"
          }>
          <p className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium'>
            {bannerPhrases.map((phrase, i) => (
              <span key={phrase} className='flex items-center gap-2'>
                {i > 0 && <span className='text-muted-foreground'>·</span>}
                <span
                  className={
                    bannerHasWarning ? "text-amber-300" : "text-foreground"
                  }>
                  {phrase}
                </span>
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Main KPI cards */}
      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        <OverviewMetricCard
          label='Spend'
          value={formatCurrency(spend, currency)}
          sub={spendSub}
          delta={buildDelta(spend, prevSpend, true)}
          warning={paceState === "over"}
        />
        <OverviewMetricCard
          label='ROAS'
          value={formatMultiplier(roas)}
          sub='Last 30 days'
          target={
            targetRoas !== null
              ? `Target ≥ ${formatMultiplier(targetRoas)}`
              : undefined
          }
          delta={buildDelta(roas, prevRoas, true)}
          warning={roasWarning}
        />
        <OverviewMetricCard
          label='Revenue'
          value={formatCurrency(convValue, currency)}
          sub='Conversion value'
          delta={buildDelta(convValue, prevConvValue, true)}
        />
        <OverviewMetricCard
          label='CPA'
          value={cpa > 0 ? formatCurrencyExact(cpa, currency) : "—"}
          sub='Last 30 days'
          target={
            targetCpa !== null
              ? `Target ≤ ${formatCurrencyExact(targetCpa, currency)}`
              : undefined
          }
          delta={cpa > 0 ? buildDelta(cpa, prevCpa, false) : null}
          warning={cpaWarning}
        />
        <OverviewMetricCard
          label='Conversions'
          value={formatInt(conversions)}
          sub='Last 30 days'
          delta={buildDelta(conversions, prevConversions, true)}
        />
      </div>

      {/* Diagnostic metrics */}
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5'>
        {diagnostics.map((d) => (
          <Card key={d.label} className='p-3'>
            <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
              {d.label}
            </p>
            <p className='mt-1 text-lg font-semibold text-foreground'>
              {d.value}
            </p>
          </Card>
        ))}
      </div>

      {/* Budget pacing widget + trend chart */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <Card className='lg:col-span-1'>
          <CardHeader className='pb-3'>
            <CardTitle>Budget pacing</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {monthlyBudget === null ? (
              <p className='text-sm text-muted-foreground'>
                No monthly budget set for this client.
              </p>
            ) : (
              <>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-muted-foreground'>Spent MTD</span>
                  <span className='font-medium'>
                    {formatCurrency(mtdSpend, currency)}
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-muted-foreground'>Monthly budget</span>
                  <span className='font-medium'>
                    {formatCurrency(monthlyBudget, currency)}
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-muted-foreground'>Days elapsed</span>
                  <span className='font-medium'>
                    {dayOfMonth} / {daysInMonth}
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-muted-foreground'>
                    Projected month-end
                  </span>
                  <span className='font-medium'>
                    {formatCurrency(projectedSpend, currency)}
                  </span>
                </div>
                <div className='h-2 w-full overflow-hidden rounded-full bg-secondary'>
                  <div
                    className={
                      paceState === "over"
                        ? "h-full bg-red-400"
                        : paceState === "under"
                          ? "h-full bg-amber-400"
                          : "h-full bg-emerald-400"
                    }
                    style={{
                      width: `${Math.min(
                        100,
                        (mtdSpend / monthlyBudget) * 100,
                      ).toFixed(1)}%`,
                    }}
                  />
                </div>
                <Badge
                  variant={
                    paceState === "over"
                      ? "destructive"
                      : paceState === "under"
                        ? "warning"
                        : "success"
                  }
                  withDot>
                  {paceLabel[paceState]}
                </Badge>
              </>
            )}
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          {chartData.length > 0 ? (
            <SpendRoasChart
              data={chartData}
              title='Daily spend — last 30 days'
              subtitle={client.name}
            />
          ) : (
            <Card className='flex h-full items-center justify-center p-6'>
              <EmptyState
                title='No trend data'
                description='Daily insights will appear once Meta sync runs.'
              />
            </Card>
          )}
        </div>
      </div>

      {/* Campaigns */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Top campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            {topCampaigns.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No campaign spend in the last 30 days.
              </p>
            ) : (
              <ul className='space-y-3'>
                {topCampaigns.map((c) => (
                  <li
                    key={c.id}
                    className='flex items-start justify-between gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0'>
                    <div className='min-w-0 space-y-1'>
                      <p className='truncate text-sm font-medium text-foreground'>
                        {c.name}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        ROAS {formatMultiplier(c.roas)} ·{" "}
                        {c.conversions > 0
                          ? `CPA ${formatCurrencyExact(c.cpa, currency)}`
                          : "No conversions"}
                      </p>
                    </div>
                    <span className='shrink-0 text-sm font-medium'>
                      {formatCurrency(c.spend, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Campaigns needing attention</CardTitle>
          </CardHeader>
          <CardContent>
            {attentionCampaigns.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                All campaigns are within target.
              </p>
            ) : (
              <ul className='space-y-3'>
                {attentionCampaigns.slice(0, 5).map((c) => (
                  <li
                    key={c.id}
                    className='flex items-start justify-between gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0'>
                    <div className='min-w-0 space-y-1'>
                      <p className='truncate text-sm font-medium text-foreground'>
                        {c.name}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        ROAS {formatMultiplier(c.roas)}
                        {c.conversions > 0
                          ? ` · CPA ${formatCurrencyExact(c.cpa, currency)}`
                          : ""}
                      </p>
                    </div>
                    <Badge variant='warning' withDot>
                      review
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Alerts + Tasks */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Recent alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No open alerts.</p>
            ) : (
              <ul className='space-y-3'>
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className='flex items-start justify-between gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0'>
                    <div className='min-w-0 space-y-1'>
                      <div className='flex items-center gap-2'>
                        <Badge variant={SEVERITY_VARIANT[a.severity]} withDot>
                          {a.severity.toLowerCase()}
                        </Badge>
                        <p className='truncate text-sm font-medium text-foreground'>
                          {a.title}
                        </p>
                      </div>
                      <p className='text-xs text-muted-foreground'>
                        {client.name}
                        {a.rule ? ` · ${a.rule}` : ""}
                      </p>
                    </div>
                    <span className='shrink-0 text-[11px] text-muted-foreground'>
                      {formatDistanceToNow(a.triggeredAt, { addSuffix: true })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-3'>
            <CardTitle>Action items</CardTitle>
          </CardHeader>
          <CardContent>
            {topTasks.length === 0 ? (
              <p className='text-sm text-muted-foreground'>No open tasks.</p>
            ) : (
              <ul className='space-y-3'>
                {topTasks.map((t) => (
                  <li
                    key={t.id}
                    className='flex items-start justify-between gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0'>
                    <div className='min-w-0 space-y-1'>
                      <p className='truncate text-sm font-medium text-foreground'>
                        {t.title}
                      </p>
                      {t.rule && (
                        <p className='text-[11px] uppercase tracking-wider text-muted-foreground'>
                          Rule · {t.rule}
                        </p>
                      )}
                    </div>
                    <Badge variant={PRIORITY_VARIANT[t.priority]} withDot>
                      {t.priority.toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recommendations placeholder */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Recommendations</CardTitle>
        </CardHeader>
        <CardContent>
          {recommendationCount > 0 ? (
            <p className='text-sm text-muted-foreground'>
              {recommendationCount} pending recommendation
              {recommendationCount === 1 ? "" : "s"}. Review workflow coming in
              a later release.
            </p>
          ) : (
            <EmptyState
              title='No recommendations yet'
              description='AI-generated recommendations will appear here.'
            />
          )}
        </CardContent>
      </Card>

      {/* Notes — de-emphasized at the bottom */}
      <Card className='border-border/40 bg-secondary/20'>
        <CardHeader className='pb-2'>
          <CardTitle className='text-sm text-muted-foreground'>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {client.notes ? (
            <p className='whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground'>
              {client.notes}
            </p>
          ) : (
            <p className='text-xs text-muted-foreground'>No notes yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

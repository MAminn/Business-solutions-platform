import { notFound } from "next/navigation";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { OverviewMetricCard } from "@/components/clients/overview-metric-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnalysisToolbar } from "@/components/clients/analysis/analysis-toolbar";
import {
  SpendTrendChart,
  RoasTrendChart,
  CpaRoasTrendChart,
  BreakdownBarChart,
} from "@/components/clients/analysis/charts";
import { TopEntitiesTable } from "@/components/clients/analysis/top-entities-table";
import {
  getClientAnalysis,
  type AnalysisLevel,
  type AnalysisPreset,
  type BreakdownRow,
} from "@/server/analysis";
import {
  formatCurrency,
  formatMultiplier,
  formatInt,
  formatDelta,
  formatPercentRaw,
} from "@/lib/format";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
  searchParams: {
    preset?: string;
    level?: string;
    start?: string;
    end?: string;
  };
}

const LEVEL_LABEL: Record<AnalysisLevel, string> = {
  ACCOUNT: "Account",
  CAMPAIGN: "Campaign",
  AD: "Ad",
};

function parsePreset(raw: string | undefined): AnalysisPreset {
  if (raw === "7" || raw === "prev_month" || raw === "custom") return raw;
  return "30";
}

function parseLevel(raw: string | undefined): AnalysisLevel {
  if (raw === "ACCOUNT" || raw === "AD") return raw;
  return "CAMPAIGN";
}

function buildDelta(
  curr: number,
  prev: number,
): { value: string; positive: boolean } | null {
  if (prev <= 0) return null;
  const pc = ((curr - prev) / prev) * 100;
  return { value: formatDelta(pc), positive: pc >= 0 };
}

interface BreakdownDatum {
  name: string;
  value: number;
  isOthers: boolean;
}

function topWithOthers(
  rows: BreakdownRow[],
  metric: "spend" | "purchases",
  total: number,
): BreakdownDatum[] {
  const sorted = [...rows].sort((a, b) => b[metric] - a[metric]);
  const top = sorted.slice(0, 10);
  const topSum = top.reduce((s, r) => s + r[metric], 0);
  const data: BreakdownDatum[] = top
    .filter((r) => r[metric] > 0)
    .map((r) => ({ name: r.name, value: r[metric], isOthers: false }));
  const others = total - topSum;
  if (sorted.length > top.length && others > 0) {
    data.push({ name: "Others", value: others, isOthers: true });
  }
  // recharts vertical bars render first item at the bottom — reverse so the
  // largest value sits at the top.
  return data.reverse();
}

export default async function ClientAnalysisPage({
  params,
  searchParams,
}: PageProps) {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(params.id)) notFound();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, industry: true },
  });
  if (!client) notFound();

  const preset = parsePreset(searchParams.preset);
  const level = parseLevel(searchParams.level);

  const analysis = await getClientAnalysis(client.id, {
    preset,
    level,
    start: searchParams.start,
    end: searchParams.end,
  });

  const { currency } = analysis;

  const header = (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{client.name}</h1>
        {client.industry && (
          <p className='mt-1 text-sm text-muted-foreground'>
            {client.industry}
          </p>
        )}
      </div>
      <ClientSubNav clientId={client.id} active='analysis' />
    </div>
  );

  if (!analysis.hasData || !analysis.range) {
    return (
      <div className='space-y-8'>
        {header}
        <EmptyState
          title='No insight data yet'
          description="Once this client's Meta ad account has synced daily insights, analysis will appear here."
        />
      </div>
    );
  }

  const { range, kpis } = analysis;

  // Inline target context (rendered only when the relevant target is set).
  const { targets } = analysis;

  let roasTarget: string | undefined;
  let roasWarning = false;
  if (targets.minRoas !== null) {
    const onTarget = kpis.roas.current >= targets.minRoas;
    roasTarget = `Target ≥ ${formatMultiplier(targets.minRoas)} · ${
      onTarget ? "On target" : "Under target"
    }`;
    roasWarning = !onTarget;
  }

  let spendTarget: string | undefined;
  if (targets.monthlyBudget !== null && targets.monthlyBudget > 0) {
    const pct = (kpis.spend.current / targets.monthlyBudget) * 100;
    spendTarget = `${formatPercentRaw(pct, 0)} of monthly budget`;
  }

  const purchasesData = topWithOthers(
    analysis.breakdown,
    "purchases",
    analysis.breakdownTotals.purchases,
  );
  const spendData = topWithOthers(
    analysis.breakdown,
    "spend",
    analysis.breakdownTotals.spend,
  );

  // Platform split is ACCOUNT level by construction and has only a handful of
  // values, so no Top-N / "Others" bucketing. Reversed because recharts renders
  // the first vertical bar at the bottom — largest spend ends up on top.
  const platform = analysis.platformBreakdown;
  const platformChartData: BreakdownDatum[] = (platform?.rows ?? [])
    .filter((r) => r.spend > 0)
    .map((r) => ({ name: r.platform, value: r.spend, isOthers: false }))
    .reverse();

  const levelLabel = LEVEL_LABEL[level];
  const prevLabel = `vs prev ${range.days}d`;

  return (
    <div className='space-y-8'>
      {header}

      <div className='flex flex-wrap items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <h2 className='text-lg font-semibold tracking-tight'>Analysis</h2>
          <Badge variant='muted'>
            {range.start} → {range.end}
          </Badge>
          {analysis.latestDataDate && (
            <span className='text-xs text-muted-foreground'>
              Latest data: {analysis.latestDataDate}
            </span>
          )}
        </div>
      </div>

      <AnalysisToolbar
        preset={preset}
        level={level}
        start={range.start}
        end={range.end}
        latestDataDate={analysis.latestDataDate}
      />

      {/* KPI cards */}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <OverviewMetricCard
          label='Spend'
          value={formatCurrency(kpis.spend.current, currency)}
          delta={buildDelta(kpis.spend.current, kpis.spend.previous)}
          sub={prevLabel}
          target={spendTarget}
        />
        <OverviewMetricCard
          label='Purchases (Meta-reported)'
          value={formatInt(kpis.purchases.current)}
          delta={buildDelta(kpis.purchases.current, kpis.purchases.previous)}
          sub={prevLabel}
        />
        <OverviewMetricCard
          label='Meta ROAS'
          value={formatMultiplier(kpis.roas.current)}
          delta={buildDelta(kpis.roas.current, kpis.roas.previous)}
          sub={prevLabel}
          target={roasTarget}
          warning={roasWarning}
        />
        <OverviewMetricCard
          label='Meta Purchase Value'
          value={formatCurrency(kpis.purchaseValue.current, currency)}
          delta={buildDelta(
            kpis.purchaseValue.current,
            kpis.purchaseValue.previous,
          )}
          sub={prevLabel}
        />
      </div>
      <p className='-mt-4 text-xs text-muted-foreground'>
        Purchases, Meta ROAS, Meta CPA and purchase value are Meta-reported and
        shown in {currency}.
      </p>

      {/* Time-series charts */}
      <div className='grid gap-6 lg:grid-cols-2'>
        <SpendTrendChart data={analysis.timeSeries} currency={currency} />
        <RoasTrendChart data={analysis.timeSeries} />
        <div className='lg:col-span-2'>
          <CpaRoasTrendChart
            data={analysis.timeSeries}
            currency={currency}
            subtitle={analysis.fatigue.note ?? "Meta-reported, dual axis"}
          />
        </div>
      </div>

      {/* Platform split — Meta publisher_platform, ACCOUNT level */}
      {platform && (
        <Card className='p-6'>
          <div className='flex flex-wrap items-center gap-3'>
            <h3 className='text-base font-semibold'>Platform split</h3>
            <Badge variant='muted'>Meta-reported · account level</Badge>
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            Account-level split across Meta placements. This panel is{" "}
            <span className='font-medium'>not</span> affected by the
            Account/Campaign/Ad level switch — that switch controls the entity
            breakdown below, not this split. Shown in {currency}.
          </p>
          {!platform.coverageComplete && (
            <p className='mt-1 text-xs text-muted-foreground'>
              Platform data covers {platform.daysPresent} of{" "}
              {platform.daysInRange} days in this range.
            </p>
          )}

          {platform.rows.length === 0 ? (
            <div className='mt-4'>
              <EmptyState
                title='No platform breakdown data'
                description='No platform breakdown data for this range. Platform splits are synced separately and cover a trailing 30-day window.'
              />
            </div>
          ) : (
            <div className='mt-4 grid gap-6 lg:grid-cols-2'>
              <BreakdownBarChart
                title='Platform by Spend'
                subtitle='Meta-reported, account level'
                data={platformChartData}
                metric='spend'
                currency={currency}
              />
              <div className='rounded-xl border border-border/60'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Platform</TableHead>
                      <TableHead className='text-right'>Spend</TableHead>
                      <TableHead className='text-right'>Share</TableHead>
                      <TableHead className='text-right'>Purchases</TableHead>
                      <TableHead className='text-right'>Meta ROAS</TableHead>
                      <TableHead className='text-right'>Meta CPA</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {platform.rows.map((r) => (
                      <TableRow key={r.platform}>
                        <TableCell className='font-medium'>
                          {r.platform}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {formatCurrency(r.spend, currency)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {formatPercentRaw(r.spendShare * 100, 0)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {formatInt(r.purchases)}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {r.spend > 0 ? formatMultiplier(r.roas) : "—"}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {r.purchases > 0
                            ? formatCurrency(r.cpa, currency)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Breakdown charts */}
      <div className='grid gap-6 lg:grid-cols-2'>
        <BreakdownBarChart
          title={`${levelLabel} by Purchases`}
          subtitle='Top 10 + Others'
          data={purchasesData}
          metric='purchases'
          currency={currency}
        />
        <BreakdownBarChart
          title={`${levelLabel} by Spend`}
          subtitle='Top 10 + Others'
          data={spendData}
          metric='spend'
          currency={currency}
        />
      </div>

      {/* Top entities table */}
      <div className='space-y-3'>
        <div className='flex items-center gap-3'>
          <h3 className='text-base font-semibold'>Top {levelLabel}s</h3>
          <Badge variant='muted'>Meta-reported</Badge>
        </div>
        {analysis.breakdown.length === 0 ? (
          <EmptyState
            title='No rows in range'
            description='No activity for the selected level and date range.'
          />
        ) : (
          <TopEntitiesTable
            rows={analysis.breakdown}
            currency={currency}
            level={level}
          />
        )}
      </div>
    </div>
  );
}

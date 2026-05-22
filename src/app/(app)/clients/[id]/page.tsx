import Link from "next/link";
import { notFound } from "next/navigation";
import { subDays, formatDistanceToNow } from "date-fns";
import type { TaskPriority } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatCurrencyExact,
  formatInt,
  formatMultiplier,
  formatPercent,
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

const SUB_TABS = [
  { label: "Overview", segment: "" },
  { label: "Campaigns", segment: "campaigns" },
  { label: "Creatives", segment: "creatives" },
  { label: "Tasks", segment: "tasks" },
] as const;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
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
    },
  });
  if (!client) notFound();

  const now = new Date();
  const d30 = subDays(now, 30);

  const campaigns = await db.campaign.findMany({
    where: { adAccountConnection: { clientId: client.id } },
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const [insights30, alerts, tasks] = await Promise.all([
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
  ]);

  const spend = num(insights30._sum.spend);
  const convValue = num(insights30._sum.conversionValue);
  const conversions = num(insights30._sum.conversions);
  const clicks = num(insights30._sum.clicks);
  const impressions = num(insights30._sum.impressions);

  const roas = spend > 0 ? convValue / spend : 0;
  const cpa = conversions > 0 ? spend / conversions : 0;
  const ctr = impressions > 0 ? clicks / impressions : 0;

  const topTasks = tasks
    .slice()
    .sort((a, b) => {
      const dp = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (dp !== 0) return dp;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, 5);

  const kpis: Array<{ label: string; value: string }> = [
    { label: "Spend", value: formatCurrency(spend) },
    { label: "ROAS", value: formatMultiplier(roas) },
    { label: "CPA", value: cpa > 0 ? formatCurrencyExact(cpa) : "—" },
    { label: "CTR", value: impressions > 0 ? formatPercent(ctr) : "—" },
    { label: "Conversions", value: formatInt(conversions) },
  ];

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

        <nav className='flex items-center gap-1 border-b border-border/60'>
          {SUB_TABS.map((tab) => {
            const href = tab.segment
              ? `/clients/${client.id}/${tab.segment}`
              : `/clients/${client.id}`;
            const active = tab.segment === "";
            return (
              <Link
                key={tab.label}
                href={href}
                className={cn(
                  "-mb-px inline-flex items-center border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}>
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* KPI strip */}
      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        {kpis.map((k) => (
          <Card key={k.label} className='p-4'>
            <p className='text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
              {k.label}
            </p>
            <p className='mt-2 text-xl font-semibold text-foreground'>
              {k.value}
            </p>
            <p className='mt-1 text-[10px] text-muted-foreground'>
              Last 30 days
            </p>
          </Card>
        ))}
      </div>

      {/* Recent alerts + tasks */}
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
            <CardTitle>Recent tasks</CardTitle>
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

      {/* Notes */}
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {client.notes ? (
            <p className='whitespace-pre-wrap text-sm leading-relaxed text-foreground'>
              {client.notes}
            </p>
          ) : (
            <EmptyState
              title='No notes yet'
              description='Edit notes — coming in a later release.'
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

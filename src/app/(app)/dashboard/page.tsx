import {
  Download,
  Plus,
  DollarSign,
  TrendingUp,
  Users,
  Sparkles,
} from "lucide-react";
import { subDays, startOfMonth } from "date-fns";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";

export const dynamic = "force-dynamic";
import { SpendRoasChart } from "@/components/dashboard/spend-roas-chart";
import { UrgentTasks } from "@/components/dashboard/urgent-tasks";
import { ActiveClients } from "@/components/dashboard/active-clients";
import {
  formatCurrencyCompact,
  formatMultiplier,
  formatDelta,
} from "@/lib/format";
import type { TaskPriority, ClientHealth, ClientStatus } from "@prisma/client";

const priorityWeight: Record<TaskPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  MED: 2,
  LOW: 1,
};

function greetingPart(date: Date): "morning" | "afternoon" | "evening" {
  const h = date.getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export default async function DashboardPage() {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);

  const now = new Date();
  const d30 = subDays(now, 30);
  const d60 = subDays(now, 60);
  const d90 = subDays(now, 90);
  const d14 = subDays(now, 14);
  const monthStart = startOfMonth(now);

  // Resolve campaigns under accessible clients (used as the join key for
  // CAMPAIGN-level insights — see note in HANDOFF).
  const campaigns = await db.campaign.findMany({
    where: {
      adAccountConnection: { clientId: { in: accessibleClientIds } },
    },
    select: {
      id: true,
      adAccountConnection: { select: { clientId: true } },
    },
  });
  const campaignIds = campaigns.map((c) => c.id);
  const campaignToClient = new Map<string, string>();
  for (const c of campaigns)
    campaignToClient.set(c.id, c.adAccountConnection.clientId);

  // ---- Aggregates --------------------------------------------------------
  const [
    sum30,
    sum60to30,
    sumByCampaign30,
    sumByCampaignMtd,
    dailySeries,
    activeCount,
    activeOlderThan90,
    winningTotal,
    winningLast14,
    urgentTasksRaw,
    clientsForList,
  ] = await Promise.all([
    db.insightsDaily.aggregate({
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d30 },
      },
      _sum: { spend: true, conversionValue: true },
    }),
    db.insightsDaily.aggregate({
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d60, lt: d30 },
      },
      _sum: { spend: true, conversionValue: true },
    }),
    db.insightsDaily.groupBy({
      by: ["entityId"],
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
        date: { gte: d30 },
      },
      _sum: { spend: true, conversionValue: true },
    }),
    db.insightsDaily.groupBy({
      by: ["entityId"],
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
    db.client.count({
      where: { id: { in: accessibleClientIds }, status: "ACTIVE" },
    }),
    db.client.count({
      where: {
        id: { in: accessibleClientIds },
        status: "ACTIVE",
        createdAt: { lt: d90 },
      },
    }),
    db.creative.count({
      where: {
        adAccountConnection: { clientId: { in: accessibleClientIds } },
        isWinner: true,
      },
    }),
    db.creative.count({
      where: {
        adAccountConnection: { clientId: { in: accessibleClientIds } },
        isWinner: true,
        createdAt: { gte: d14 },
      },
    }),
    db.task.findMany({
      where: { clientId: { in: accessibleClientIds }, status: "TODO" },
      include: { client: { select: { name: true } } },
    }),
    db.client.findMany({
      where: { id: { in: accessibleClientIds } },
      select: {
        id: true,
        name: true,
        industry: true,
        health: true,
        status: true,
        monthlyBudget: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // ---- KPI: Spend Under Management --------------------------------------
  const spend30 = num(sum30._sum.spend);
  const spendPrev = num(sum60to30._sum.spend);
  const spendDeltaPct =
    spendPrev > 0 ? ((spend30 - spendPrev) / spendPrev) * 100 : 0;

  // ---- KPI: Average ROAS (weighted) -------------------------------------
  const conv30 = num(sum30._sum.conversionValue);
  const convPrev = num(sum60to30._sum.conversionValue);
  const roas30 = spend30 > 0 ? conv30 / spend30 : 0;
  const roasPrev = spendPrev > 0 ? convPrev / spendPrev : 0;
  const roasDeltaPct =
    roasPrev > 0 ? ((roas30 - roasPrev) / roasPrev) * 100 : 0;

  // ---- KPI: Active Clients ----------------------------------------------
  const activeDelta = activeCount - activeOlderThan90;

  // ---- KPI: Winning Creatives -------------------------------------------
  const winnersDelta = winningLast14;

  // ---- Per-client aggregates (for ActiveClients list) -------------------
  const mtdByClient = new Map<string, number>();
  for (const row of sumByCampaignMtd) {
    const clientId = campaignToClient.get(row.entityId);
    if (!clientId) continue;
    mtdByClient.set(
      clientId,
      (mtdByClient.get(clientId) ?? 0) + num(row._sum.spend),
    );
  }
  const last30ByClient = new Map<string, { spend: number; conv: number }>();
  for (const row of sumByCampaign30) {
    const clientId = campaignToClient.get(row.entityId);
    if (!clientId) continue;
    const cur = last30ByClient.get(clientId) ?? { spend: 0, conv: 0 };
    cur.spend += num(row._sum.spend);
    cur.conv += num(row._sum.conversionValue);
    last30ByClient.set(clientId, cur);
  }

  const activeClientsList: Array<{
    id: string;
    name: string;
    industry: string | null;
    health: ClientHealth;
    pacing: number;
    roas: number;
  }> = clientsForList
    .filter(
      (c): c is typeof c & { status: ClientStatus } => c.status === "ACTIVE",
    )
    .map((c) => {
      const budget = num(c.monthlyBudget);
      const mtd = mtdByClient.get(c.id) ?? 0;
      const pacing = budget > 0 ? Math.round((mtd / budget) * 100) : 0;
      const r = last30ByClient.get(c.id);
      const roas = r && r.spend > 0 ? r.conv / r.spend : 0;
      return {
        id: c.id,
        name: c.name,
        industry: c.industry,
        health: c.health,
        pacing,
        roas,
      };
    });

  // ---- Urgent tasks (sorted by priority weight, top 5) ------------------
  const urgentTasks = urgentTasksRaw
    .slice()
    .sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority])
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      client: t.client.name,
      rule: t.rule,
      priority: t.priority,
    }));

  // ---- Chart series -----------------------------------------------------
  const chartData = dailySeries.map((d) => ({
    date: d.date.toISOString(),
    spend: num(d._sum.spend),
  }));

  // ---- Greeting ---------------------------------------------------------
  const firstName = (user.name ?? "there").split(" ")[0] ?? "there";
  const part = greetingPart(now);

  return (
    <div className='space-y-8'>
      {/* Header */}
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>
            Good {part}, {firstName}
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Here&apos;s how your portfolio is performing today.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm'>
            <Download className='h-4 w-4' />
            Export
          </Button>
          <Button size='sm'>
            <Plus className='h-4 w-4' />
            New campaign
          </Button>
        </div>
      </div>

      {/* KPI grid */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <KpiCard
          label='Spend Under Management'
          value={formatCurrencyCompact(spend30)}
          delta={{
            value: formatDelta(spendDeltaPct),
            label: "vs prev 30d",
            positive: spendDeltaPct >= 0,
          }}
          icon={DollarSign}
        />
        <KpiCard
          label='Average ROAS'
          value={formatMultiplier(roas30)}
          delta={{
            value: formatDelta(roasDeltaPct),
            label: "vs prev 30d",
            positive: roasDeltaPct >= 0,
          }}
          icon={TrendingUp}
        />
        <KpiCard
          label='Active Clients'
          value={String(activeCount)}
          delta={{
            value: `${activeDelta >= 0 ? "+" : ""}${activeDelta}`,
            label: "vs 90d ago",
            positive: activeDelta >= 0,
          }}
          icon={Users}
        />
        <KpiCard
          label='Winning Creatives'
          value={String(winningTotal)}
          delta={{
            value: `${winnersDelta >= 0 ? "+" : ""}${winnersDelta}`,
            label: "new in 14d",
            positive: winnersDelta >= 0,
          }}
          icon={Sparkles}
        />
      </div>

      {/* Chart + Urgent tasks */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <SpendRoasChart data={chartData} />
        </div>
        <UrgentTasks tasks={urgentTasks} />
      </div>

      {/* Active clients */}
      <ActiveClients clients={activeClientsList} />
    </div>
  );
}

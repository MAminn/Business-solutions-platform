import {
  Download,
  Plus,
  DollarSign,
  TrendingUp,
  Users,
  Sparkles,
} from "lucide-react";
import { subDays, startOfMonth, differenceInDays } from "date-fns";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";

export const dynamic = "force-dynamic";
import { SpendRoasChart } from "@/components/dashboard/spend-roas-chart";
import { UrgentTasks } from "@/components/dashboard/urgent-tasks";
import { ActiveClients } from "@/components/dashboard/active-clients";
import { FlagsPanel } from "@/components/dashboard/flags-panel";
import { buildFlags, type DashboardFlagClient } from "@/lib/dashboard-flags";
import { groupCreativesByAsset } from "@/lib/creatives/group-by-asset";
import {
  formatCurrencyCompact,
  formatMultiplier,
  formatDelta,
} from "@/lib/format";
import type { TaskPriority, ClientHealth } from "@prisma/client";

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
    creativesForWinners,
    urgentTasksRaw,
    clientsForList,
    connectionsFreshness,
    latestDataByCampaign,
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
    // Creatives (with asset-identity fields + ads) across accessible clients,
    // used to derive the live Winning Creatives count by grouped asset.
    db.creative.findMany({
      where: {
        adAccountConnection: { clientId: { in: accessibleClientIds } },
      },
      select: {
        id: true,
        effectiveObjectStoryId: true,
        objectStoryId: true,
        videoId: true,
        imageHash: true,
        imageUrl: true,
        adAccountConnection: { select: { clientId: true } },
        ads: { select: { id: true } },
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
        minRoas: true,
      },
      orderBy: { name: "asc" },
    }),
    db.adAccountConnection.findMany({
      where: { clientId: { in: accessibleClientIds } },
      select: { clientId: true, currency: true, insightsBackfilledAt: true },
    }),
    db.insightsDaily.groupBy({
      by: ["entityId"],
      where: {
        entityType: "CAMPAIGN",
        entityId: { in: campaignIds },
      },
      _max: { date: true },
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

  // ---- KPI: Active Clients (spend-based) --------------------------------
  // A client counts iff it is ACTIVE AND has real spend in the same last-30d
  // window used by Spend Under Management. Zero-spend ACTIVE clients are
  // excluded. No delta sub-label (the old "vs 90d ago" referenced a count
  // that no longer exists).
  const activeCount = clientsForList.filter(
    (c) => c.status === "ACTIVE" && (last30ByClient.get(c.id)?.spend ?? 0) > 0,
  ).length;

  // ---- KPI: Winning Creatives (live-derived, Meta-reported) -------------
  // Per grouped creative asset over the last-30d window: spend > 0 AND
  // purchases > 0 AND the asset's client has a non-null minRoas AND the
  // asset's Meta-reported ROAS (conversionValue / spend) meets that target.
  // Clients with a null minRoas are excluded (no target to test against).
  const minRoasByClient = new Map<string, number | null>(
    clientsForList.map((c) => [
      c.id,
      c.minRoas != null ? num(c.minRoas) : null,
    ]),
  );
  const adIdsForWinners = creativesForWinners.flatMap((cr) =>
    cr.ads.map((a) => a.id),
  );
  const winnerSumByAd = new Map<
    string,
    { spend: number; purchases: number; conv: number }
  >();
  if (adIdsForWinners.length > 0) {
    const adInsightRows = await db.insightsDaily.groupBy({
      by: ["entityId"],
      where: {
        entityType: "AD",
        entityId: { in: adIdsForWinners },
        date: { gte: d30 },
      },
      _sum: { spend: true, purchases: true, conversionValue: true },
    });
    for (const r of adInsightRows) {
      winnerSumByAd.set(r.entityId, {
        spend: num(r._sum.spend),
        purchases: num(r._sum.purchases),
        conv: num(r._sum.conversionValue),
      });
    }
  }
  // Group creatives per client, then collapse same-asset rows into one card,
  // summing the three metrics across every member creative's ads.
  const creativesByClient = new Map<string, typeof creativesForWinners>();
  for (const cr of creativesForWinners) {
    const clientId = cr.adAccountConnection.clientId;
    const list = creativesByClient.get(clientId) ?? [];
    list.push(cr);
    creativesByClient.set(clientId, list);
  }
  let winningTotal = 0;
  for (const [clientId, clientCreatives] of creativesByClient) {
    const minRoas = minRoasByClient.get(clientId) ?? null;
    if (minRoas == null) continue; // no target → cannot qualify
    for (const members of groupCreativesByAsset(clientCreatives)) {
      let spend = 0;
      let purchases = 0;
      let conv = 0;
      for (const member of members) {
        for (const ad of member.ads) {
          const s = winnerSumByAd.get(ad.id);
          if (!s) continue;
          spend += s.spend;
          purchases += s.purchases;
          conv += s.conv;
        }
      }
      const assetRoas = spend > 0 ? conv / spend : 0;
      if (spend > 0 && purchases > 0 && assetRoas >= minRoas) winningTotal += 1;
    }
  }

  // ---- Data freshness (per client) --------------------------------------
  const FRESH_DAYS = 3;
  const backfilledByClient = new Map<string, Date | null>();
  for (const conn of connectionsFreshness) {
    // A client counts as backfilled if ANY of its connections has completed a
    // full insights backfill; only fully-null clients are treated as missing.
    if (conn.insightsBackfilledAt) {
      const existing = backfilledByClient.get(conn.clientId) ?? null;
      if (!existing || conn.insightsBackfilledAt > existing) {
        backfilledByClient.set(conn.clientId, conn.insightsBackfilledAt);
      }
    } else if (!backfilledByClient.has(conn.clientId)) {
      backfilledByClient.set(conn.clientId, null);
    }
  }

  // ---- Currency derivation (presentation only, no FX) -------------------
  // Per-client connection currency (null when a single client somehow spans
  // multiple currencies) and a portfolio-wide currency that is only set when
  // every accessible connection shares one currency. Mixed/none → null so we
  // never label a cross-currency sum with a single symbol.
  const currencyByClient = new Map<string, string | null>();
  const distinctCurrencies = new Set<string>();
  for (const conn of connectionsFreshness) {
    distinctCurrencies.add(conn.currency);
    const existing = currencyByClient.get(conn.clientId);
    if (existing === undefined)
      currencyByClient.set(conn.clientId, conn.currency);
    else if (existing !== conn.currency)
      currencyByClient.set(conn.clientId, null);
  }
  const portfolioCurrency: string | null =
    distinctCurrencies.size === 1
      ? (distinctCurrencies.values().next().value ?? null)
      : null;

  const latestDateByClient = new Map<string, Date>();
  for (const row of latestDataByCampaign) {
    const clientId = campaignToClient.get(row.entityId);
    const d = row._max.date;
    if (!clientId || !d) continue;
    const existing = latestDateByClient.get(clientId);
    if (!existing || d > existing) latestDateByClient.set(clientId, d);
  }
  function clientFreshness(clientId: string): {
    isStale: boolean;
    staleDays: number | null;
  } {
    const backfilledAt = backfilledByClient.get(clientId) ?? null;
    const latest = latestDateByClient.get(clientId) ?? null;
    const staleDays = latest ? differenceInDays(now, latest) : null;
    const isStale =
      backfilledAt == null ||
      latest == null ||
      (staleDays != null && staleDays > FRESH_DAYS);
    return { isStale, staleDays };
  }

  // ---- Active funding cycles (per client, active-cycle rule) ------------
  // One batched read: cycles with cancelledAt null, most recent by startedAt.
  // Rows come back startedAt desc, so the first row seen per client is the
  // active one (mirrors funding.ts activeCycleIndex without any writes).
  const activeFundingCycles = await db.fundingCycle.findMany({
    where: {
      cancelledAt: null,
      adAccountConnection: { clientId: { in: accessibleClientIds } },
    },
    orderBy: { startedAt: "desc" },
    select: {
      amount: true,
      currency: true,
      adAccountConnection: { select: { clientId: true } },
    },
  });
  const fundingByClient = new Map<
    string,
    { amount: number; currency: string }
  >();
  for (const cycle of activeFundingCycles) {
    const clientId = cycle.adAccountConnection.clientId;
    if (fundingByClient.has(clientId)) continue; // first row = most recent active
    fundingByClient.set(clientId, {
      amount: num(cycle.amount),
      currency: cycle.currency,
    });
  }

  const activeClientsList: Array<{
    id: string;
    name: string;
    industry: string | null;
    health: ClientHealth;
    pacing: number;
    roas: number;
    isStale: boolean;
    mtdSpend: number;
    monthlyBudget: number;
    currency: string | null;
    funding?: { amount: number; currency: string };
  }> = [];
  const flagClients: DashboardFlagClient[] = [];
  for (const c of clientsForList) {
    if (c.status !== "ACTIVE") continue;
    const budget = num(c.monthlyBudget);
    const mtd = mtdByClient.get(c.id) ?? 0;
    const pacing = budget > 0 ? Math.round((mtd / budget) * 100) : 0;
    const r = last30ByClient.get(c.id);
    const roas = r && r.spend > 0 ? r.conv / r.spend : 0;
    const { isStale, staleDays } = clientFreshness(c.id);
    activeClientsList.push({
      id: c.id,
      name: c.name,
      industry: c.industry,
      health: c.health,
      pacing,
      roas,
      isStale,
      mtdSpend: mtd,
      monthlyBudget: budget,
      currency: currencyByClient.get(c.id) ?? null,
      funding: fundingByClient.get(c.id),
    });
    flagClients.push({
      clientId: c.id,
      clientName: c.name,
      isStale,
      staleDays,
      pacing,
      roas,
      minRoas: c.minRoas != null ? num(c.minRoas) : null,
    });
  }
  const flags = buildFlags(flagClients);

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

      {/* Flags strip — decision layer */}
      <FlagsPanel flags={flags} />

      {/* KPI grid */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <KpiCard
          label='Spend Under Management'
          value={
            portfolioCurrency
              ? formatCurrencyCompact(spend30, portfolioCurrency)
              : new Intl.NumberFormat("en-US", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                }).format(spend30)
          }
          caption={portfolioCurrency ? undefined : "Mixed currencies"}
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
          caption='Meta-reported'
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
          icon={Users}
        />
        <KpiCard
          label='Winning Creatives'
          value={String(winningTotal)}
          caption='Meta-reported'
          icon={Sparkles}
        />
      </div>

      {/* Chart + Urgent tasks */}
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-3'>
        <div className='lg:col-span-2'>
          <SpendRoasChart data={chartData} currency={portfolioCurrency} />
        </div>
        <UrgentTasks tasks={urgentTasks} />
      </div>

      {/* Active clients */}
      <ActiveClients clients={activeClientsList} />
    </div>
  );
}

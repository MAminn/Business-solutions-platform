import Link from "next/link";
import { Plus } from "lucide-react";
import { subDays, startOfMonth } from "date-fns";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientCard } from "@/components/clients/client-card";

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export default async function ClientsPage() {
  const user = await requireUser();
  const accessibleClientIds = await getAccessibleClientIds(user);

  const now = new Date();
  const d30 = subDays(now, 30);
  const monthStart = startOfMonth(now);

  const [clients, campaigns] = await Promise.all([
    db.client.findMany({
      where: { id: { in: accessibleClientIds } },
      select: {
        id: true,
        name: true,
        industry: true,
        logoUrl: true,
        health: true,
        monthlyBudget: true,
        minRoas: true,
      },
      orderBy: { name: "asc" },
    }),
    db.campaign.findMany({
      where: {
        adAccountConnection: { clientId: { in: accessibleClientIds } },
      },
      select: {
        id: true,
        adAccountConnection: { select: { clientId: true } },
      },
    }),
  ]);

  const campaignIds = campaigns.map((c) => c.id);
  const campaignToClient = new Map<string, string>();
  for (const c of campaigns)
    campaignToClient.set(c.id, c.adAccountConnection.clientId);

  const [sumByCampaign30, sumByCampaignMtd] = await Promise.all([
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
  ]);

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

  const cards = clients.map((c) => {
    const budget = num(c.monthlyBudget);
    const mtd = mtdByClient.get(c.id) ?? 0;
    const pacing = budget > 0 ? Math.round((mtd / budget) * 100) : 0;
    const r = last30ByClient.get(c.id);
    const roas = r && r.spend > 0 ? r.conv / r.spend : 0;
    return {
      id: c.id,
      name: c.name,
      industry: c.industry,
      logoUrl: c.logoUrl,
      health: c.health,
      monthlyBudget: budget,
      pacing,
      roas,
    };
  });

  return (
    <div className='space-y-8'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Client Hub</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Manage your roster, ad accounts, and campaign strategies.
          </p>
        </div>
        <Button asChild size='sm'>
          <Link href='/clients/new'>
            <Plus className='h-4 w-4' />
            Add client
          </Link>
        </Button>
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title='No clients yet'
          description='Add your first client to start tracking performance.'
          action={
            <Button asChild size='sm'>
              <Link href='/clients/new'>
                <Plus className='h-4 w-4' />
                Add client
              </Link>
            </Button>
          }
        />
      ) : (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'>
          {cards.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </div>
      )}
    </div>
  );
}

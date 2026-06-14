import { notFound } from "next/navigation";
import { subDays } from "date-fns";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import {
  CreativesView,
  type CreativeItem,
  type CreativeDailyPoint,
} from "@/components/creatives/creatives-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

const WINDOW_DAYS = 90;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

// Best-effort deep link into Meta Ads Manager for reviewing an ad's creative
// in its native environment. Not an API call — just a shortcut URL.
function buildMetaAdReviewUrl(accountId: string, adId: string): string {
  const numericAccountId = accountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(numericAccountId)}&selected_ad_ids=${encodeURIComponent(adId)}`;
}

export default async function ClientCreativesPage({ params }: PageProps) {
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
      bodyText: true,
      callToAction: true,
      createdAt: true,
      adAccountConnectionId: true,
      ads: {
        select: {
          id: true,
          name: true,
          platformId: true,
          effectiveStatus: true,
          adSet: {
            select: {
              name: true,
              campaign: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Ad-level daily insights for the window, grouped by ad.
  const adIds = creatives.flatMap((c) => c.ads.map((a) => a.id));
  const rowsByAd = new Map<string, CreativeDailyPoint[]>();
  if (adIds.length > 0) {
    const rows = await db.insightsDaily.findMany({
      where: {
        entityType: "AD",
        entityId: { in: adIds },
        date: { gte: subDays(new Date(), WINDOW_DAYS) },
      },
      select: {
        entityId: true,
        date: true,
        spend: true,
        impressions: true,
        clicks: true,
        purchases: true,
        conversionValue: true,
        frequency: true,
      },
      orderBy: { date: "asc" },
    });
    for (const r of rows) {
      const list = rowsByAd.get(r.entityId) ?? [];
      list.push({
        date: r.date.toISOString().slice(0, 10),
        spend: num(r.spend),
        impressions: r.impressions,
        clicks: r.clicks,
        purchases: r.purchases,
        conversionValue: num(r.conversionValue),
        frequency: r.frequency === null ? null : num(r.frequency),
      });
      rowsByAd.set(r.entityId, list);
    }
  }

  const items: CreativeItem[] = creatives.map((cr) => {
    // Merge daily rows across all ads of this creative, keyed by date.
    const byDate = new Map<string, CreativeDailyPoint>();
    for (const ad of cr.ads) {
      for (const p of rowsByAd.get(ad.id) ?? []) {
        const cur = byDate.get(p.date);
        if (!cur) {
          byDate.set(p.date, { ...p });
        } else {
          cur.spend += p.spend;
          cur.impressions += p.impressions;
          cur.clicks += p.clicks;
          cur.purchases += p.purchases;
          cur.conversionValue += p.conversionValue;
          if (p.frequency !== null) {
            cur.frequency =
              cur.frequency === null
                ? p.frequency
                : (cur.frequency + p.frequency) / 2;
          }
        }
      }
    }
    const daily = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const primaryAd = cr.ads[0];
    // Prefer a linked ad that actually spent in the window for the deep link.
    const reviewAd =
      cr.ads.find(
        (ad) =>
          ad.platformId && (rowsByAd.get(ad.id) ?? []).some((p) => p.spend > 0),
      ) ??
      cr.ads.find((ad) => ad.platformId) ??
      primaryAd;
    const accountId = accountIdByConnection.get(cr.adAccountConnectionId);
    const reviewUrl =
      reviewAd?.platformId && accountId
        ? buildMetaAdReviewUrl(accountId, reviewAd.platformId)
        : null;

    // Launch date: first day with delivery if available, else creation date.
    const launchDate =
      daily.length > 0 ? daily[0].date : cr.createdAt.toISOString();

    return {
      id: cr.id,
      name: cr.name,
      type: cr.type,
      status: primaryAd?.effectiveStatus ?? null,
      preview: cr.thumbnailUrl ?? cr.imageUrl ?? null,
      bodyText: cr.bodyText,
      headline: cr.headline,
      callToAction: cr.callToAction,
      campaignName: primaryAd?.adSet?.campaign?.name ?? null,
      adsetName: primaryAd?.adSet?.name ?? null,
      adName: primaryAd?.name ?? null,
      adPlatformId: primaryAd?.platformId ?? null,
      launchDate,
      reviewUrl,
      daily,
    };
  });

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
          Visual library of image and video assets — Meta-reported performance,
          last 30 days. Currency {currency}, account timezone.
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title='No creatives synced yet'
          description='Run sync to import creatives.'
        />
      ) : (
        <CreativesView creatives={items} currency={currency} />
      )}
    </div>
  );
}

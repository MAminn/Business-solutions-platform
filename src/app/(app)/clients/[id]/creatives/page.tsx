import { notFound } from "next/navigation";
import { subDays } from "date-fns";
import { CreativeAssetKind, CreativeAssetStatus } from "@prisma/client";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { EmptyState } from "@/components/shared/empty-state";
import { ClientSubNav } from "@/components/clients/sub-nav";
import { groupCreativesByAsset } from "@/lib/creatives/group-by-asset";
import { cleanCreativeName } from "@/lib/creatives/display-name";
import { resolveLatestDataDate } from "@/lib/date-window";
import {
  CreativesView,
  type CreativeItem,
  type CreativeDailyPoint,
  type CreativeLinkedAd,
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

// Direct link to the published Facebook post backing the creative, derived from
// the (effective_)object_story_id of the form "{pageId}_{postId}". Read-only
// shortcut — not an API call.
function buildMetaPreviewUrl(
  effectiveObjectStoryId: string | null,
  objectStoryId: string | null,
): string | null {
  const storyId = effectiveObjectStoryId ?? objectStoryId;
  if (!storyId) return null;
  const sep = storyId.indexOf("_");
  if (sep <= 0 || sep >= storyId.length - 1) return null;
  const pageId = storyId.slice(0, sep);
  const postId = storyId.slice(sep + 1);
  return `https://www.facebook.com/${encodeURIComponent(pageId)}/posts/${encodeURIComponent(postId)}`;
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

  // Campaign IDs for this client's connections — needed only to resolve the
  // canonical latest-data-date (ACCOUNT preferred, CAMPAIGN fallback).
  const clientCampaigns = await db.campaign.findMany({
    where: { adAccountConnectionId: { in: connectionIds } },
    select: { id: true },
  });
  const campaignIds = clientCampaigns.map((c) => c.id);

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
      objectStoryId: true,
      effectiveObjectStoryId: true,
      imageHash: true,
      videoId: true,
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
        ctr: true,
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
        ctr: r.ctr === null ? null : num(r.ctr),
      });
      rowsByAd.set(r.entityId, list);
    }
  }

  // Collapse creatives that point at the same underlying asset/post into one
  // group. Many Creative rows (one per ad) can share a single asset, which
  // previously rendered as duplicate cards.
  const groups = groupCreativesByAsset(creatives);
  // Resolve READY full-res image assets (Step 1 ingestion) for every member
  // creative in one query, so cards/drawer can render from the authenticated
  // /api/creative-assets route instead of a (possibly expired) Meta URL.
  const allCreativeIds = groups.flat().map((m) => m.id);
  const readyAssets = allCreativeIds.length
    ? await db.creativeAsset.findMany({
        where: {
          creativeId: { in: allCreativeIds },
          kind: CreativeAssetKind.IMAGE,
          status: CreativeAssetStatus.READY,
        },
        select: { id: true, creativeId: true },
      })
    : [];
  const assetIdByCreative = new Map(
    readyAssets.map((a) => [a.creativeId, a.id]),
  );

  // One-time production comparison against the DB audit (no UI rendering).
  console.info(
    "[creatives] asset dedupe",
    JSON.stringify({
      clientId: client.id,
      connectionIds,
      rawCreatives: creatives.length,
      groupedCards: groups.length,
    }),
  );

  // Canonical latest-data-date anchor (ACCOUNT preferred, CAMPAIGN fallback),
  // resolved server-side and passed as a plain ISO date string boundary.
  const { latest } = await resolveLatestDataDate(connectionIds, campaignIds);
  const latestDataDate = latest ? latest.toISOString().slice(0, 10) : null;

  const items: CreativeItem[] = groups.map((members) => {
    const primary = members[0];
    // Union the ads of every member creative in the group.
    const ads = members.flatMap((m) => m.ads);

    // Merge daily rows across all ads of this group, keyed by date.
    const byDate = new Map<string, CreativeDailyPoint>();
    // Stored per-day ctr and frequency are each merged as a true average
    // (sum/count of non-null stored values) across every ad on the same date —
    // mirrors the per-day ctr averaging in creative-report/route.ts. Never the
    // pairwise (cur+p)/2 form, never impression-weighted, never recomputed
    // from clicks/impressions.
    const ctrByDate = new Map<string, { sum: number; count: number }>();
    const freqByDate = new Map<string, { sum: number; count: number }>();
    for (const ad of ads) {
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
        }
        if (p.ctr !== null) {
          const acc = ctrByDate.get(p.date) ?? { sum: 0, count: 0 };
          acc.sum += p.ctr;
          acc.count += 1;
          ctrByDate.set(p.date, acc);
        }
        if (p.frequency !== null) {
          const acc = freqByDate.get(p.date) ?? { sum: 0, count: 0 };
          acc.sum += p.frequency;
          acc.count += 1;
          freqByDate.set(p.date, acc);
        }
      }
    }
    // Resolve the merged stored ctr/frequency per date from the sum/count
    // accumulators (true average of non-null values).
    for (const [date, point] of byDate) {
      const ctrAcc = ctrByDate.get(date);
      point.ctr = ctrAcc && ctrAcc.count > 0 ? ctrAcc.sum / ctrAcc.count : null;
      const freqAcc = freqByDate.get(date);
      point.frequency =
        freqAcc && freqAcc.count > 0 ? freqAcc.sum / freqAcc.count : null;
    }
    const daily = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const primaryAd = ads[0];
    // Prefer a linked ad that actually spent in the window for the deep link.
    const reviewAd =
      ads.find(
        (ad) =>
          ad.platformId && (rowsByAd.get(ad.id) ?? []).some((p) => p.spend > 0),
      ) ??
      ads.find((ad) => ad.platformId) ??
      primaryAd;
    const accountId = accountIdByConnection.get(primary.adAccountConnectionId);
    const adReviewUrl =
      reviewAd?.platformId && accountId
        ? buildMetaAdReviewUrl(accountId, reviewAd.platformId)
        : null;
    // Prefer a direct link to the published post; fall back to Ads Manager.
    const storyMember =
      members.find((m) => m.effectiveObjectStoryId ?? m.objectStoryId) ??
      primary;
    const postPreviewUrl = buildMetaPreviewUrl(
      storyMember.effectiveObjectStoryId,
      storyMember.objectStoryId,
    );
    // Derived post ID, using the SAME split as buildMetaPreviewUrl: the part
    // after the first "_" of the story id ("{pageId}_{postId}"). In-memory
    // passthrough only — no DB field, no re-parse.
    const storyIdForPost =
      storyMember.effectiveObjectStoryId ?? storyMember.objectStoryId;
    let postId: string | null = null;
    if (storyIdForPost) {
      const sep = storyIdForPost.indexOf("_");
      if (sep > 0 && sep < storyIdForPost.length - 1) {
        postId = storyIdForPost.slice(sep + 1);
      }
    }
    const reviewUrl = postPreviewUrl ?? adReviewUrl;
    // True only when the link points at a real published post (story-id
    // derived permalink), not the Ads Manager fallback. Drives honest labeling.
    const hasRealPostPreview = Boolean(postPreviewUrl);

    // Launch date: first day with delivery if available, else creation date.
    const launchDate =
      daily.length > 0 ? daily[0].date : primary.createdAt.toISOString();

    // Prefer a locally-ingested READY image asset (served through the
    // authenticated route) over Meta URLs. Take the first member that has one,
    // preserving the group's existing member order.
    const readyAssetId = members
      .map((m) => assetIdByCreative.get(m.id))
      .find((id): id is string => Boolean(id));
    const readyAssetUrl = readyAssetId
      ? `/api/creative-assets/${readyAssetId}`
      : null;

    // Preview: READY asset, then first member's imageUrl, then thumbnailUrl.
    const preview =
      readyAssetUrl ?? primary.imageUrl ?? primary.thumbnailUrl ?? null;

    const linkedAds: CreativeLinkedAd[] = ads.map((ad) => ({
      id: ad.id,
      name: ad.name,
      effectiveStatus: ad.effectiveStatus,
      adsetName: ad.adSet?.name ?? null,
      campaignName: ad.adSet?.campaign?.name ?? null,
    }));

    return {
      id: primary.id,
      name: cleanCreativeName({
        name: primary.name,
        headline: primary.headline,
        type: primary.type,
      }),
      type: primary.type,
      status: primaryAd?.effectiveStatus ?? null,
      preview,
      bodyText: primary.bodyText,
      headline: primary.headline,
      callToAction: primary.callToAction,
      campaignName: primaryAd?.adSet?.campaign?.name ?? null,
      adsetName: primaryAd?.adSet?.name ?? null,
      adName: primaryAd?.name ?? null,
      adPlatformId: primaryAd?.platformId ?? null,
      launchDate,
      reviewUrl,
      hasRealPostPreview,
      postId,
      daily,
      linkedAds,
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
        <CreativesView
          creatives={items}
          currency={currency}
          latestDataDate={latestDataDate}
        />
      )}
    </div>
  );
}

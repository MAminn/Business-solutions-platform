/**
 * Meta sync service.
 *
 * Three entry points called from cron / queue jobs:
 *   - syncStructural(connectionId)         — campaigns, adsets, ads, creatives
 *   - syncInsightsIncremental(connectionId) — last 2 days, daily granularity
 *   - syncInsightsBackfill(connectionId, days) — initial / on-demand backfill
 *
 * Each run creates a SyncJob row for observability. Tokens are decrypted
 * just-in-time and never logged.
 *
 * NOTE: Phase 1 implementation. For accounts with > 50 active ads you'll
 * want to switch to async batch reports (POST /act_x/insights → poll).
 * That upgrade is tracked as a TODO inside fetchInsightsForEntities.
 */

import { db } from "@/lib/db";
import { decryptToken } from "@/lib/encryption";
import { MetaClient, MetaRateLimitError } from "./client";
import type { MetaCreative } from "./client";
import {
  SyncJobType,
  SyncJobStatus,
  InsightEntity,
  ConnectionStatus,
  CreativeType,
} from "@prisma/client";
import { format, subDays } from "date-fns";

function mapCreativeType(creative: MetaCreative): CreativeType {
  const objectType = (creative.object_type ?? "").toUpperCase();
  if (creative.video_id || objectType === "VIDEO") return CreativeType.VIDEO;
  if (
    objectType === "PHOTO" ||
    objectType === "IMAGE" ||
    objectType === "SHARE"
  ) {
    return CreativeType.IMAGE;
  }
  if (objectType === "CAROUSEL") return CreativeType.CAROUSEL;
  return CreativeType.IMAGE;
}

/**
 * Upserts an ad's creative into the Creative table (keyed by
 * connection + platform creative id) and returns the internal Creative.id
 * so the ad can be linked. Returns null when the ad has no creative.
 */
async function upsertCreative(
  connectionId: string,
  adName: string,
  creative: MetaCreative | undefined,
): Promise<string | null> {
  if (!creative?.id) return null;

  const data = {
    name: creative.name ?? adName ?? creative.id,
    type: mapCreativeType(creative),
    thumbnailUrl: creative.thumbnail_url,
    imageUrl: creative.image_url,
    bodyText: creative.body,
    headline: creative.title,
    callToAction: creative.call_to_action_type,
    raw: creative as unknown as object,
  };

  const row = await db.creative.upsert({
    where: {
      adAccountConnectionId_platformId: {
        adAccountConnectionId: connectionId,
        platformId: creative.id,
      },
    },
    create: {
      adAccountConnectionId: connectionId,
      platformId: creative.id,
      ...data,
    },
    update: data,
    select: { id: true },
  });
  return row.id;
}

async function getMetaClient(connectionId: string): Promise<{
  meta: MetaClient;
  platformAccountId: string;
  connectionId: string;
} | null> {
  const conn = await db.adAccountConnection.findUnique({
    where: { id: connectionId },
    include: { metaAppProfile: { select: { apiVersion: true } } },
  });
  if (!conn) return null;
  if (conn.status !== ConnectionStatus.ACTIVE) return null;
  if (!conn.accessTokenEnc) return null;

  const token = decryptToken(conn.accessTokenEnc);
  // Use the connection's profile API version. Legacy connections without a
  // profile fall back to the env-configured version (handled by MetaClient).
  const apiVersion =
    conn.metaAppProfile?.apiVersion ??
    process.env.META_API_VERSION ??
    undefined;
  return {
    meta: new MetaClient(token, apiVersion),
    platformAccountId: conn.platformAccountId,
    connectionId: conn.id,
  };
}

async function runJob<T>(
  connectionId: string,
  type: SyncJobType,
  fn: () => Promise<{ recordsSynced: number; result: T }>,
): Promise<T> {
  const job = await db.syncJob.create({
    data: {
      adAccountConnectionId: connectionId,
      type,
      status: SyncJobStatus.RUNNING,
      startedAt: new Date(),
    },
  });

  try {
    const { recordsSynced, result } = await fn();
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncJobStatus.SUCCESS,
        recordsSynced,
        completedAt: new Date(),
      },
    });
    await db.adAccountConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: new Date(), lastSyncError: null },
    });
    return result;
  } catch (err) {
    const isRateLimit =
      err instanceof Error && err.name === "MetaRateLimitError";
    const message = err instanceof Error ? err.message : String(err);
    const persisted = isRateLimit ? `RATE_LIMIT: ${message}` : message;
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncJobStatus.FAILED,
        errorMessage: persisted,
        completedAt: new Date(),
      },
    });
    await db.adAccountConnection.update({
      where: { id: connectionId },
      data: { lastSyncError: persisted },
    });
    throw err;
  }
}

// ============================================================================
// 1. Structural sync — campaigns, adsets, ads
// ============================================================================
export async function syncStructural(connectionId: string): Promise<void> {
  await runJob(connectionId, SyncJobType.STRUCTURAL, async () => {
    const ctx = await getMetaClient(connectionId);
    if (!ctx) throw new Error("Connection not available");
    const { meta, platformAccountId } = ctx;

    let records = 0;

    // Campaigns
    const remoteCampaigns = await meta.listCampaigns(platformAccountId);
    for (const rc of remoteCampaigns) {
      await db.campaign.upsert({
        where: {
          adAccountConnectionId_platformId: {
            adAccountConnectionId: connectionId,
            platformId: rc.id,
          },
        },
        create: {
          adAccountConnectionId: connectionId,
          platformId: rc.id,
          name: rc.name,
          objective: rc.objective,
          status: rc.status,
          effectiveStatus: rc.effective_status,
          dailyBudget: rc.daily_budget
            ? Number(rc.daily_budget) / 100
            : undefined,
          lifetimeBudget: rc.lifetime_budget
            ? Number(rc.lifetime_budget) / 100
            : undefined,
          buyingType: rc.buying_type,
          startTime: rc.start_time ? new Date(rc.start_time) : undefined,
          stopTime: rc.stop_time ? new Date(rc.stop_time) : undefined,
          specialAdCategories: rc.special_ad_categories ?? undefined,
          raw: rc as unknown as object,
        },
        update: {
          name: rc.name,
          status: rc.status,
          effectiveStatus: rc.effective_status,
          dailyBudget: rc.daily_budget
            ? Number(rc.daily_budget) / 100
            : undefined,
          lifetimeBudget: rc.lifetime_budget
            ? Number(rc.lifetime_budget) / 100
            : undefined,
          raw: rc as unknown as object,
        },
      });
      records++;

      // Ad sets for this campaign
      const campaignRow = await db.campaign.findUnique({
        where: {
          adAccountConnectionId_platformId: {
            adAccountConnectionId: connectionId,
            platformId: rc.id,
          },
        },
      });
      if (!campaignRow) continue;

      const remoteAdSets = await meta.listAdSets(rc.id);
      for (const rs of remoteAdSets) {
        await db.adSet.upsert({
          where: {
            campaignId_platformId: {
              campaignId: campaignRow.id,
              platformId: rs.id,
            },
          },
          create: {
            campaignId: campaignRow.id,
            platformId: rs.id,
            name: rs.name,
            status: rs.status,
            effectiveStatus: rs.effective_status,
            dailyBudget: rs.daily_budget
              ? Number(rs.daily_budget) / 100
              : undefined,
            lifetimeBudget: rs.lifetime_budget
              ? Number(rs.lifetime_budget) / 100
              : undefined,
            optimizationGoal: rs.optimization_goal,
            billingEvent: rs.billing_event,
            bidStrategy: rs.bid_strategy,
            startTime: rs.start_time ? new Date(rs.start_time) : undefined,
            endTime: rs.end_time ? new Date(rs.end_time) : undefined,
            raw: rs as unknown as object,
          },
          update: {
            name: rs.name,
            status: rs.status,
            effectiveStatus: rs.effective_status,
            raw: rs as unknown as object,
          },
        });
        records++;

        const adSetRow = await db.adSet.findUnique({
          where: {
            campaignId_platformId: {
              campaignId: campaignRow.id,
              platformId: rs.id,
            },
          },
        });
        if (!adSetRow) continue;

        const remoteAds = await meta.listAds(rs.id);
        for (const ra of remoteAds) {
          const creativeId = await upsertCreative(
            connectionId,
            ra.name,
            ra.creative,
          );
          await db.ad.upsert({
            where: {
              adSetId_platformId: { adSetId: adSetRow.id, platformId: ra.id },
            },
            create: {
              adSetId: adSetRow.id,
              platformId: ra.id,
              name: ra.name,
              status: ra.status,
              effectiveStatus: ra.effective_status,
              creativeId: creativeId ?? undefined,
              raw: ra as unknown as object,
            },
            update: {
              name: ra.name,
              status: ra.status,
              effectiveStatus: ra.effective_status,
              creativeId: creativeId ?? undefined,
              raw: ra as unknown as object,
            },
          });
          records++;
        }
      }
    }

    // Reconcile: delete campaigns (and their adsets, ads, polymorphic
    // InsightsDaily rows) for this connection that Meta no longer returns.
    // Without this, seed fakes or campaigns deleted in Meta would linger
    // and cause per-object 400s during the insights pull.
    const remotePlatformIds = remoteCampaigns.map((rc) => rc.id);
    const staleCampaigns = await db.campaign.findMany({
      where: {
        adAccountConnectionId: connectionId,
        platformId: { notIn: remotePlatformIds },
      },
      select: { id: true },
    });

    if (staleCampaigns.length > 0) {
      const staleCampaignIds = staleCampaigns.map((c) => c.id);

      const staleAdSets = await db.adSet.findMany({
        where: { campaignId: { in: staleCampaignIds } },
        select: { id: true },
      });
      const staleAdSetIds = staleAdSets.map((s) => s.id);

      const staleAds = await db.ad.findMany({
        where: { adSetId: { in: staleAdSetIds } },
        select: { id: true },
      });
      const staleAdIds = staleAds.map((a) => a.id);

      // InsightsDaily is polymorphic (entityType + entityId, no FK), so it
      // is NOT removed by cascade — clean it up explicitly first.
      await db.insightsDaily.deleteMany({
        where: {
          OR: [
            {
              entityType: InsightEntity.CAMPAIGN,
              entityId: { in: staleCampaignIds },
            },
            {
              entityType: InsightEntity.AD_SET,
              entityId: { in: staleAdSetIds },
            },
            { entityType: InsightEntity.AD, entityId: { in: staleAdIds } },
          ],
        },
      });

      // Schema has onDelete: Cascade on AdSet.campaign and Ad.adSet, but
      // delete in explicit order anyway — clearer and resilient to schema
      // changes.
      await db.ad.deleteMany({ where: { id: { in: staleAdIds } } });
      await db.adSet.deleteMany({ where: { id: { in: staleAdSetIds } } });
      await db.campaign.deleteMany({ where: { id: { in: staleCampaignIds } } });
    }

    return { recordsSynced: records, result: undefined };
  });
}

// ============================================================================
// 2. Incremental insights — last 2 days
// ============================================================================
export async function syncInsightsIncremental(
  connectionId: string,
): Promise<void> {
  await runJob(connectionId, SyncJobType.INSIGHTS_INCREMENTAL, async () => {
    const ctx = await getMetaClient(connectionId);
    if (!ctx) throw new Error("Connection not available");
    const since = format(subDays(new Date(), 2), "yyyy-MM-dd");
    const until = format(new Date(), "yyyy-MM-dd");
    const count = await fetchInsightsForEntities(
      ctx,
      connectionId,
      since,
      until,
    );
    return { recordsSynced: count, result: undefined };
  });
}

// ============================================================================
// 3. Backfill — N days
// ============================================================================
export async function syncInsightsBackfill(
  connectionId: string,
  days = 30,
): Promise<void> {
  await runJob(connectionId, SyncJobType.INSIGHTS_BACKFILL, async () => {
    const ctx = await getMetaClient(connectionId);
    if (!ctx) throw new Error("Connection not available");
    const since = format(subDays(new Date(), days), "yyyy-MM-dd");
    const until = format(new Date(), "yyyy-MM-dd");
    const count = await fetchInsightsForEntities(
      ctx,
      connectionId,
      since,
      until,
    );
    return { recordsSynced: count, result: undefined };
  });
}

// ============================================================================
// Shared insights pull
// ============================================================================
async function fetchInsightsForEntities(
  ctx: NonNullable<Awaited<ReturnType<typeof getMetaClient>>>,
  connectionId: string,
  since: string,
  until: string,
): Promise<number> {
  const { meta, platformAccountId } = ctx;
  let records = 0;

  // Account level
  const accountInsights = await meta.getInsightsDaily(
    platformAccountId,
    since,
    until,
  );
  for (const ins of accountInsights) {
    await persistInsight(InsightEntity.ACCOUNT, connectionId, ins);
    records++;
  }

  // Campaigns
  const campaigns = await db.campaign.findMany({
    where: { adAccountConnectionId: connectionId },
    select: { id: true, platformId: true },
  });

  // Per-entity fetches are wrapped so a single failing object (e.g. an
  // entity deleted in Meta between structural and insights sync) does not
  // abort the entire job. If EVERY fetch fails we surface the error so the
  // SyncJob is correctly marked FAILED rather than silently succeeding.
  let perEntityAttempts = 0;
  let perEntitySuccesses = 0;
  const skipped: { entityId: string; message: string }[] = [];

  // TODO: For accounts with > 50 active ads switch to async batch reports:
  //   POST /act_x/insights with level=ad → returns a report_run_id, poll for state.
  for (const c of campaigns) {
    perEntityAttempts++;
    try {
      const insights = await meta.getInsightsDaily(c.platformId, since, until);
      for (const ins of insights) {
        await persistInsight(InsightEntity.CAMPAIGN, c.id, ins);
        records++;
      }
      perEntitySuccesses++;
    } catch (err) {
      // A rate limit will affect every subsequent call — stop now and let
      // runJob mark the job RATE_LIMIT rather than hammering the API.
      if (err instanceof MetaRateLimitError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (skipped.length < 10) {
        skipped.push({ entityId: c.platformId, message });
      }
      continue;
    }
  }

  if (perEntityAttempts > 0 && perEntitySuccesses === 0 && skipped.length > 0) {
    const first = skipped[0]!;
    throw new Error(
      `All ${perEntityAttempts} insight fetches failed; first error (${first.entityId}): ${first.message}`,
    );
  }

  // Ads — ad-level insights power the Creatives analytics. Pulled per ad
  // with the same resilient skip-and-continue behaviour as campaigns so a
  // single deleted ad cannot abort the job. (Account/campaign success above
  // already guards the "everything failed" case, so ad failures only warn.)
  const ads = await db.ad.findMany({
    where: { adSet: { campaign: { adAccountConnectionId: connectionId } } },
    select: { id: true, platformId: true },
  });

  let adInsightRecords = 0;
  let adsWithInsights = 0;
  let adsSkipped = 0;

  for (const a of ads) {
    try {
      const insights = await meta.getInsightsDaily(a.platformId, since, until);
      if (insights.length > 0) adsWithInsights++;
      for (const ins of insights) {
        await persistInsight(InsightEntity.AD, a.id, ins);
        records++;
        adInsightRecords++;
      }
    } catch (err) {
      // On rate limit, stop cleanly — continuing would spam Meta and every
      // remaining ad would fail anyway. runJob marks the job RATE_LIMIT.
      if (err instanceof MetaRateLimitError) throw err;
      // Otherwise skip this ad; account/campaign data is already saved.
      adsSkipped++;
      continue;
    }
  }

  console.log(
    `[meta] ad-level insights: ${adInsightRecords} rows across ` +
      `${adsWithInsights}/${ads.length} ads (${adsSkipped} skipped)`,
  );

  return records;
}

async function persistInsight(
  entityType: InsightEntity,
  entityId: string,
  ins: import("./client").MetaInsight,
): Promise<void> {
  const purchase = ins.actions?.find((a) => a.action_type === "purchase");
  const purchaseValue = ins.action_values?.find(
    (a) => a.action_type === "purchase",
  );
  const purchaseRoas = ins.purchase_roas?.[0]?.value;
  const video3s = ins.video_play_actions?.find(
    (a) => a.action_type === "video_view",
  );

  const spend = ins.spend ? Number(ins.spend) : 0;
  const impressions = ins.impressions ? Number(ins.impressions) : 0;
  const purchases = purchase ? Number(purchase.value) : 0;

  await db.insightsDaily.upsert({
    where: {
      entityType_entityId_date: {
        entityType,
        entityId,
        date: new Date(ins.date_start),
      },
    },
    create: {
      entityType,
      entityId,
      date: new Date(ins.date_start),
      impressions,
      reach: ins.reach ? Number(ins.reach) : 0,
      clicks: ins.clicks ? Number(ins.clicks) : 0,
      spend: spend.toFixed(2),
      ctr: ins.ctr ? Number(ins.ctr).toFixed(4) : null,
      cpc: ins.cpc ? Number(ins.cpc).toFixed(4) : null,
      cpm: ins.cpm ? Number(ins.cpm).toFixed(2) : null,
      frequency: ins.frequency ? Number(ins.frequency).toFixed(2) : null,
      conversions: purchases,
      purchases,
      conversionValue: purchaseValue
        ? Number(purchaseValue.value).toFixed(2)
        : "0",
      roas: purchaseRoas ? Number(purchaseRoas).toFixed(4) : null,
      cpa: purchases > 0 ? (spend / purchases).toFixed(2) : null,
      videoViews3s: video3s ? Number(video3s.value) : null,
      videoViewsP25: ins.video_p25_watched_actions?.[0]?.value
        ? Number(ins.video_p25_watched_actions[0]!.value)
        : null,
      videoViewsP50: ins.video_p50_watched_actions?.[0]?.value
        ? Number(ins.video_p50_watched_actions[0]!.value)
        : null,
      videoViewsP75: ins.video_p75_watched_actions?.[0]?.value
        ? Number(ins.video_p75_watched_actions[0]!.value)
        : null,
      videoViewsP100: ins.video_p100_watched_actions?.[0]?.value
        ? Number(ins.video_p100_watched_actions[0]!.value)
        : null,
      hookRate:
        video3s && impressions > 0
          ? (Number(video3s.value) / impressions).toFixed(4)
          : null,
      raw: ins as unknown as object,
    },
    update: {
      // Re-pull always replaces today's and yesterday's data (attribution shifts)
      impressions,
      spend: spend.toFixed(2),
      purchases,
      conversions: purchases,
      conversionValue: purchaseValue
        ? Number(purchaseValue.value).toFixed(2)
        : "0",
      roas: purchaseRoas ? Number(purchaseRoas).toFixed(4) : null,
      cpa: purchases > 0 ? (spend / purchases).toFixed(2) : null,
      raw: ins as unknown as object,
    },
  });
}

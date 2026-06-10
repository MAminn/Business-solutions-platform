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
 * Insights are pulled at the ad-account level with a `level` breakdown
 * (level=campaign and level=ad) and full cursor pagination, rather than one
 * Graph API call per entity. This avoids Meta rate limit code 17 / 2446079
 * on large accounts.
 */

import { db } from "@/lib/db";
import { decryptToken } from "@/lib/encryption";
import { MetaClient } from "./client";
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

export async function getMetaClient(connectionId: string): Promise<{
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
    // Keep updating lastSyncedAt after any successful job for backward
    // compatibility, and additionally stamp the type-specific timestamp.
    // The mode decision keys off insightsBackfilledAt (set only here on a
    // successful INSIGHTS_BACKFILL), so a successful structural sync can never
    // cause a later sync to skip the full insights backfill.
    const now = new Date();
    await db.adAccountConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
        ...(type === SyncJobType.STRUCTURAL ? { structuralSyncedAt: now } : {}),
        ...(type === SyncJobType.INSIGHTS_BACKFILL
          ? { insightsBackfilledAt: now }
          : {}),
      },
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

    // ---- 1. Campaigns (account-level, paginated) ------------------------
    const remoteCampaigns = await meta.listCampaigns(platformAccountId);
    const campaignByPlatformId = new Map<string, string>();
    for (const rc of remoteCampaigns) {
      const campaign = await db.campaign.upsert({
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
      campaignByPlatformId.set(rc.id, campaign.id);
      records++;
    }

    // ---- 2. Ad sets (account-level, paginated) --------------------------
    const remoteAdSets = await meta.listAccountAdSets(platformAccountId);
    const adSetByPlatformId = new Map<string, string>();
    let adSetsSkipped = 0;
    for (const rs of remoteAdSets) {
      const campaignLocalId = rs.campaign_id
        ? campaignByPlatformId.get(rs.campaign_id)
        : undefined;
      // Parent campaign not in the live set (deleted/orphaned) — skip safely.
      if (!campaignLocalId) {
        adSetsSkipped++;
        continue;
      }
      const adSet = await db.adSet.upsert({
        where: {
          campaignId_platformId: {
            campaignId: campaignLocalId,
            platformId: rs.id,
          },
        },
        create: {
          campaignId: campaignLocalId,
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
      adSetByPlatformId.set(rs.id, adSet.id);
      records++;
    }

    // ---- 3. Ads (account-level, paginated) ------------------------------
    const remoteAds = await meta.listAccountAds(platformAccountId);
    let adsSkipped = 0;
    for (const ra of remoteAds) {
      const adSetLocalId = ra.adset_id
        ? adSetByPlatformId.get(ra.adset_id)
        : undefined;
      // Parent adset not in the live set (deleted/orphaned) — skip safely.
      if (!adSetLocalId) {
        adsSkipped++;
        continue;
      }
      const creativeId = await upsertCreative(
        connectionId,
        ra.name,
        ra.creative,
      );
      await db.ad.upsert({
        where: {
          adSetId_platformId: { adSetId: adSetLocalId, platformId: ra.id },
        },
        create: {
          adSetId: adSetLocalId,
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

    console.log(
      `[meta] structural sync: ${remoteCampaigns.length} campaigns, ` +
        `${remoteAdSets.length} adsets (${adSetsSkipped} orphaned), ` +
        `${remoteAds.length} ads (${adsSkipped} orphaned)`,
    );

    // ---- Reconcile / stale-entity cleanup -------------------------------
    // Account-level fetching gives us the complete live set in one place, so
    // we can prune every entity Meta no longer returns — not just whole
    // deleted campaigns, but individual deleted adsets/ads under a campaign
    // that still exists. Without this, seed fakes or deleted entities linger
    // and pollute downstream metrics.
    const remoteCampaignIds = remoteCampaigns.map((rc) => rc.id);
    const remoteAdSetIds = remoteAdSets.map((rs) => rs.id);
    const remoteAdIds = remoteAds.map((ra) => ra.id);

    const staleCampaigns = await db.campaign.findMany({
      where: {
        adAccountConnectionId: connectionId,
        platformId: { notIn: remoteCampaignIds },
      },
      select: { id: true },
    });
    const staleCampaignIds = staleCampaigns.map((c) => c.id);

    const staleAdSets = await db.adSet.findMany({
      where: {
        campaign: { adAccountConnectionId: connectionId },
        platformId: { notIn: remoteAdSetIds },
      },
      select: { id: true },
    });
    const staleAdSetIds = staleAdSets.map((s) => s.id);

    const staleAds = await db.ad.findMany({
      where: {
        adSet: { campaign: { adAccountConnectionId: connectionId } },
        platformId: { notIn: remoteAdIds },
      },
      select: { id: true },
    });
    const staleAdIds = staleAds.map((a) => a.id);

    if (
      staleCampaignIds.length > 0 ||
      staleAdSetIds.length > 0 ||
      staleAdIds.length > 0
    ) {
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
      // delete in explicit child→parent order anyway — clearer and resilient
      // to schema changes.
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
// Insights are fetched at the AD ACCOUNT level with a `level` breakdown and
// followed across every page of cursor pagination. This replaces the previous
// per-campaign / per-adset / per-ad loops, which made one Graph API call per
// entity and tripped Meta rate limit code 17 / 2446079 on large accounts.
async function fetchInsightsForEntities(
  ctx: NonNullable<Awaited<ReturnType<typeof getMetaClient>>>,
  connectionId: string,
  since: string,
  until: string,
): Promise<number> {
  const { meta, platformAccountId } = ctx;
  let records = 0;

  // ---- Account level (single entity, single call) -------------------------
  const accountInsights = await meta.getInsightsDaily(
    platformAccountId,
    since,
    until,
  );
  for (const ins of accountInsights) {
    await persistInsight(InsightEntity.ACCOUNT, connectionId, ins);
    records++;
  }

  // ---- Build platformId → local id lookups --------------------------------
  const campaigns = await db.campaign.findMany({
    where: { adAccountConnectionId: connectionId },
    select: { id: true, platformId: true },
  });
  const campaignByPlatformId = new Map(
    campaigns.map((c) => [c.platformId, c.id]),
  );

  const ads = await db.ad.findMany({
    where: { adSet: { campaign: { adAccountConnectionId: connectionId } } },
    select: { id: true, platformId: true },
  });
  const adByPlatformId = new Map(ads.map((a) => [a.platformId, a.id]));

  // ---- Campaign-level insights (account-wide, paginated) ------------------
  // A rate limit (code 17 / 2446079) thrown here is a MetaRateLimitError and
  // propagates to runJob, which marks the job RATE_LIMIT. We do NOT retry.
  const campaignRows = await meta.getAccountInsightsByLevel(
    platformAccountId,
    "campaign",
    since,
    until,
  );
  let campaignRowsSkipped = 0;
  for (const ins of campaignRows) {
    const localId = ins.campaign_id
      ? campaignByPlatformId.get(ins.campaign_id)
      : undefined;
    // Row for a campaign that no longer exists locally (e.g. deleted/orphaned
    // in Meta between structural and insights sync) — skip safely.
    if (!localId) {
      campaignRowsSkipped++;
      continue;
    }
    await persistInsight(InsightEntity.CAMPAIGN, localId, ins);
    records++;
  }

  // ---- Ad-level insights (account-wide, paginated) ------------------------
  const adRows = await meta.getAccountInsightsByLevel(
    platformAccountId,
    "ad",
    since,
    until,
  );
  let adRowsPersisted = 0;
  let adRowsSkipped = 0;
  for (const ins of adRows) {
    const localId = ins.ad_id ? adByPlatformId.get(ins.ad_id) : undefined;
    if (!localId) {
      adRowsSkipped++;
      continue;
    }
    await persistInsight(InsightEntity.AD, localId, ins);
    records++;
    adRowsPersisted++;
  }

  console.log(
    `[meta] account-level insights: campaigns ${campaignRows.length} rows ` +
      `(${campaignRowsSkipped} unmatched), ads ${adRows.length} rows ` +
      `(${adRowsPersisted} persisted, ${adRowsSkipped} unmatched)`,
  );

  return records;
}

/**
 * Total for a Meta action stat. Uses the top-level `value` when it parses to
 * a finite number; otherwise falls back to summing the attribution-window
 * fields (`7d_click` + `1d_view`), which is all Meta returns when conversions
 * are entirely window-attributed (common on new accounts). Never returns NaN.
 */
function actionTotal(
  action:
    | { value?: string; "7d_click"?: string; "1d_view"?: string }
    | null
    | undefined,
): number {
  if (!action) return 0;
  const direct = Number(action.value);
  if (Number.isFinite(direct)) return direct;
  let sum = 0;
  let found = false;
  for (const v of [action["7d_click"], action["1d_view"]]) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      sum += n;
      found = true;
    }
  }
  return found ? sum : 0;
}

/** Returns the number if finite, otherwise null. */
function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/**
 * Formats a number as a fixed-decimal string for a Postgres numeric column,
 * or null when the value is nullish, non-finite, or would overflow the
 * column's precision (abs(value) >= maxAbsExclusive). Out-of-range values are
 * dropped rather than clamped — the original is still preserved in `raw`.
 */
function decimalOrNull(
  value: number | null | undefined,
  decimals: number,
  maxAbsExclusive: number,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) >= maxAbsExclusive) return null;
  return value.toFixed(decimals);
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
  const roasAction = ins.purchase_roas?.[0];
  const purchaseRoas = roasAction
    ? finiteOrNull(
        Number(
          roasAction.value ?? roasAction["7d_click"] ?? roasAction["1d_view"],
        ),
      )
    : null;
  const video3s = ins.video_play_actions?.find(
    (a) => a.action_type === "video_view",
  );

  const spend = ins.spend ? Number(ins.spend) : 0;
  const impressions = ins.impressions ? Number(ins.impressions) : 0;
  const purchases = actionTotal(purchase);
  const videoViews3s = video3s ? actionTotal(video3s) : null;

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
        ? actionTotal(purchaseValue).toFixed(2)
        : "0",
      roas: decimalOrNull(purchaseRoas, 4, 10000),
      cpa: purchases > 0 ? (spend / purchases).toFixed(2) : null,
      videoViews3s,
      videoViewsP25: finiteOrNull(
        Number(ins.video_p25_watched_actions?.[0]?.value),
      ),
      videoViewsP50: finiteOrNull(
        Number(ins.video_p50_watched_actions?.[0]?.value),
      ),
      videoViewsP75: finiteOrNull(
        Number(ins.video_p75_watched_actions?.[0]?.value),
      ),
      videoViewsP100: finiteOrNull(
        Number(ins.video_p100_watched_actions?.[0]?.value),
      ),
      hookRate:
        videoViews3s !== null && impressions > 0
          ? (videoViews3s / impressions).toFixed(4)
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
        ? actionTotal(purchaseValue).toFixed(2)
        : "0",
      roas: decimalOrNull(purchaseRoas, 4, 10000),
      cpa: purchases > 0 ? (spend / purchases).toFixed(2) : null,
      raw: ins as unknown as object,
    },
  });
}

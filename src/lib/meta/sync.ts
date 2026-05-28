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
import { MetaClient } from "./client";
import {
  SyncJobType,
  SyncJobStatus,
  InsightEntity,
  ConnectionStatus,
} from "@prisma/client";
import { format, subDays } from "date-fns";

async function getMetaClient(connectionId: string): Promise<{
  meta: MetaClient;
  platformAccountId: string;
  connectionId: string;
} | null> {
  const conn = await db.adAccountConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) return null;
  if (conn.status !== ConnectionStatus.ACTIVE) return null;
  if (!conn.accessTokenEnc) return null;

  const token = decryptToken(conn.accessTokenEnc);
  return {
    meta: new MetaClient(token),
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
    const message = err instanceof Error ? err.message : String(err);
    await db.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncJobStatus.FAILED,
        errorMessage: message,
        completedAt: new Date(),
      },
    });
    await db.adAccountConnection.update({
      where: { id: connectionId },
      data: { lastSyncError: message },
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
              raw: ra as unknown as object,
            },
            update: {
              name: ra.name,
              status: ra.status,
              effectiveStatus: ra.effective_status,
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

/**
 * audit-mach-insights.ts
 *
 * READ-ONLY production-safe diagnostic. Reports whether a Meta ad account's
 * insights data is complete. It NEVER modifies anything: no writes, no schema
 * changes, no sync functions, no Meta/Graph API calls, no token decryption.
 *
 * It uses Prisma read operations only (findFirst/findMany/count/aggregate/
 * distinct) and is safe to run repeatedly with identical output and no side
 * effects.
 *
 * Usage:
 *   ACCOUNT_ID="act_2106505896497404" tsx scripts/audit-mach-insights.ts
 *
 * Exit codes:
 *   0 — script ran successfully (regardless of PASS/FAIL verdict)
 *   1 — connection not found, or the script errored
 */
import {
  PrismaClient,
  SyncJobType,
  SyncJobStatus,
  InsightEntity,
} from "@prisma/client";

const prisma = new PrismaClient();

// A complete 30-day window should land in roughly this many distinct dates.
const MIN_WINDOW_DATES = 28;
// 1–2 distinct dates is the signature of incremental-only data (no backfill).
const INCREMENTAL_ONLY_MAX_DATES = 2;

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function fmtDateOnly(value: Date | null): string {
  if (!value) return "—";
  return value.toISOString().slice(0, 10);
}

function heading(title: string): void {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

async function aggregateLevel(
  entityType: InsightEntity,
  entityIds: string[],
): Promise<{ count: number; min: Date | null; max: Date | null }> {
  // Guard against an empty `in` list (returns no rows, but avoids a needless query path).
  if (entityIds.length === 0) {
    return { count: 0, min: null, max: null };
  }
  const result = await prisma.insightsDaily.aggregate({
    where: { entityType, entityId: { in: entityIds } },
    _count: { _all: true },
    _min: { date: true },
    _max: { date: true },
  });
  return {
    count: result._count._all,
    min: result._min.date ?? null,
    max: result._max.date ?? null,
  };
}

async function main(): Promise<void> {
  const accountId = process.env.ACCOUNT_ID?.trim();
  if (!accountId) {
    console.error(
      "ERROR: ACCOUNT_ID environment variable is required (the Meta platformAccountId, e.g. act_2106505896497404).",
    );
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // 1. Connection
  // --------------------------------------------------------------------------
  heading("1. CONNECTION");
  const connection = await prisma.adAccountConnection.findFirst({
    where: { platformAccountId: accountId },
    select: {
      id: true,
      accountName: true,
      platformAccountId: true,
      lastSyncedAt: true,
      lastSyncError: true,
    },
  });

  if (!connection) {
    console.error(
      `ERROR: No AdAccountConnection found with platformAccountId = "${accountId}".`,
    );
    process.exit(1);
  }

  console.log(`Connection id:      ${connection.id}`);
  console.log(`accountName:        ${connection.accountName}`);
  console.log(`platformAccountId:  ${connection.platformAccountId}`);
  console.log(`lastSyncedAt:       ${fmt(connection.lastSyncedAt)}`);
  console.log(`lastSyncError:      ${fmt(connection.lastSyncError)}`);

  // --------------------------------------------------------------------------
  // 2. Latest SyncJob per type
  // --------------------------------------------------------------------------
  heading("2. LATEST SyncJob PER TYPE");
  for (const type of Object.values(SyncJobType)) {
    const job = await prisma.syncJob.findFirst({
      where: { adAccountConnectionId: connection.id, type },
      orderBy: { createdAt: "desc" },
      select: {
        type: true,
        status: true,
        recordsSynced: true,
        createdAt: true,
        completedAt: true,
        errorMessage: true,
      },
    });

    if (!job) {
      console.log(`${type}: NEVER RAN`);
      continue;
    }

    console.log(`${type}:`);
    console.log(`  status:        ${fmt(job.status)}`);
    console.log(`  recordsSynced: ${fmt(job.recordsSynced)}`);
    console.log(`  createdAt:     ${fmt(job.createdAt)}`);
    console.log(`  completedAt:   ${fmt(job.completedAt)}`);
    console.log(`  errorMessage:  ${fmt(job.errorMessage)}`);
  }

  // --------------------------------------------------------------------------
  // 3. Backfill success check
  // --------------------------------------------------------------------------
  heading("3. BACKFILL SUCCESS CHECK");
  const backfillSuccessCount = await prisma.syncJob.count({
    where: {
      adAccountConnectionId: connection.id,
      type: SyncJobType.INSIGHTS_BACKFILL,
      status: SyncJobStatus.SUCCESS,
    },
  });
  console.log(
    `INSIGHTS_BACKFILL jobs with status SUCCESS: ${backfillSuccessCount}`,
  );
  console.log(
    "(This is the key signal for whether a full backfill ever completed.)",
  );

  // --------------------------------------------------------------------------
  // Gather entity IDs (read-only) for the level aggregations.
  // --------------------------------------------------------------------------
  const campaigns = await prisma.campaign.findMany({
    where: { adAccountConnectionId: connection.id },
    select: { id: true },
  });
  const campaignIds = campaigns.map((c) => c.id);

  const adSets =
    campaignIds.length > 0
      ? await prisma.adSet.findMany({
          where: { campaignId: { in: campaignIds } },
          select: { id: true },
        })
      : [];
  const adSetIds = adSets.map((s) => s.id);

  const ads =
    adSetIds.length > 0
      ? await prisma.ad.findMany({
          where: { adSetId: { in: adSetIds } },
          select: { id: true },
        })
      : [];
  const adIds = ads.map((a) => a.id);

  // --------------------------------------------------------------------------
  // 4. Insight row counts and date span by level
  // --------------------------------------------------------------------------
  heading("4. InsightsDaily ROW COUNTS & DATE SPAN BY LEVEL");

  const accountAgg = await aggregateLevel(InsightEntity.ACCOUNT, [
    connection.id,
  ]);
  const campaignAgg = await aggregateLevel(InsightEntity.CAMPAIGN, campaignIds);
  const adAgg = await aggregateLevel(InsightEntity.AD, adIds);

  console.log(
    `ACCOUNT  (1 entity):           rows=${accountAgg.count}  minDate=${fmtDateOnly(
      accountAgg.min,
    )}  maxDate=${fmtDateOnly(accountAgg.max)}`,
  );
  console.log(
    `CAMPAIGN (${campaignIds.length} entities):${" ".repeat(
      Math.max(1, 12 - String(campaignIds.length).length),
    )}rows=${campaignAgg.count}  minDate=${fmtDateOnly(
      campaignAgg.min,
    )}  maxDate=${fmtDateOnly(campaignAgg.max)}`,
  );
  console.log(
    `AD       (${adIds.length} entities):${" ".repeat(
      Math.max(1, 12 - String(adIds.length).length),
    )}rows=${adAgg.count}  minDate=${fmtDateOnly(adAgg.min)}  maxDate=${fmtDateOnly(
      adAgg.max,
    )}`,
  );

  // --------------------------------------------------------------------------
  // 5. Distinct insight dates (campaign level)
  // --------------------------------------------------------------------------
  heading("5. DISTINCT CAMPAIGN-LEVEL INSIGHT DATES");
  const distinctDateRows =
    campaignIds.length > 0
      ? await prisma.insightsDaily.findMany({
          where: {
            entityType: InsightEntity.CAMPAIGN,
            entityId: { in: campaignIds },
          },
          distinct: ["date"],
          orderBy: { date: "asc" },
          select: { date: true },
        })
      : [];

  const distinctDates = distinctDateRows.map((r) => r.date);
  console.log(`Distinct campaign-level dates: ${distinctDates.length}`);
  for (const d of distinctDates) {
    console.log(`  ${fmtDateOnly(d)}`);
  }
  console.log(
    "(~30 consecutive dates => a 30-day window is present; only 1–2 dates => incremental-only data.)",
  );

  // --------------------------------------------------------------------------
  // 6. Zero-rows vs zero-spend distinction (campaign level)
  // --------------------------------------------------------------------------
  heading("6. ZERO-ROWS vs ZERO-SPEND DISTINCTION (campaign level)");
  const totalCampaigns = campaignIds.length;

  // Campaigns that have at least one InsightsDaily row.
  const campaignsWithRowsRows =
    campaignIds.length > 0
      ? await prisma.insightsDaily.findMany({
          where: {
            entityType: InsightEntity.CAMPAIGN,
            entityId: { in: campaignIds },
          },
          distinct: ["entityId"],
          select: { entityId: true },
        })
      : [];
  const campaignsWithRows = campaignsWithRowsRows.length;
  const campaignsWithNoRows = totalCampaigns - campaignsWithRows;

  console.log(`Total campaigns:                       ${totalCampaigns}`);
  console.log(`Campaigns with >=1 InsightsDaily row:  ${campaignsWithRows}`);
  console.log(`Campaigns with NO insight rows:        ${campaignsWithNoRows}`);
  console.log(
    "(No rows = data gap. Rows present but zero spend = genuinely inactive. These are NOT the same.)",
  );

  // --------------------------------------------------------------------------
  // 7. Pass/Fail conclusion
  // --------------------------------------------------------------------------
  heading("7. VERDICT");

  const distinctDateCount = distinctDates.length;
  const hasBackfillSuccess = backfillSuccessCount > 0;
  const hasWindow = distinctDateCount >= MIN_WINDOW_DATES;
  const incrementalOnly =
    distinctDateCount > 0 && distinctDateCount <= INCREMENTAL_ONLY_MAX_DATES;
  const lastSyncedSet = connection.lastSyncedAt !== null;

  const reasons: string[] = [];

  if (incrementalOnly) {
    reasons.push(
      `Only ${distinctDateCount} distinct campaign date(s) present — looks like incremental-only data, not a 30-day window.`,
    );
  }
  if (!hasBackfillSuccess) {
    reasons.push("No INSIGHTS_BACKFILL job ever succeeded.");
  }
  if (lastSyncedSet && !hasBackfillSuccess) {
    reasons.push(
      "lastSyncedAt is set while no backfill has succeeded — the overloaded-field divergence (a sync ran, but the full history was never backfilled).",
    );
  }
  if (!hasWindow && !incrementalOnly) {
    reasons.push(
      `Distinct campaign date span is ${distinctDateCount} day(s); a complete window needs >= ${MIN_WINDOW_DATES}.`,
    );
  }

  const pass = hasWindow && hasBackfillSuccess;

  console.log("");
  if (pass) {
    console.log("RESULT: PASS");
    console.log(
      `  - A 30-day window is present (${distinctDateCount} distinct campaign dates, >= ${MIN_WINDOW_DATES}).`,
    );
    console.log(
      `  - At least one INSIGHTS_BACKFILL job succeeded (${backfillSuccessCount}).`,
    );
    console.log("  => Insights data appears complete and trustworthy.");
  } else {
    console.log("RESULT: FAIL");
    if (reasons.length === 0) {
      reasons.push(
        `Window present=${hasWindow}, backfill succeeded=${hasBackfillSuccess}.`,
      );
    }
    for (const reason of reasons) {
      console.log(`  - ${reason}`);
    }
    console.log(
      "  => Insights data is NOT trustworthy; investigate before relying on it.",
    );
  }
  console.log("");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("");
    console.error("Script errored:");
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

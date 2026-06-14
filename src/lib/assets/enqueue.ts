/**
 * Structural-sync enqueue hook for creative-asset ingestion.
 *
 * Row inserts ONLY — never fetches media. Called at the end of a structural
 * sync to queue PENDING IngestionJob(kind=IMAGE) rows for creatives that are
 * currently active OR have spent in the last 30 days, and that have an image
 * source (imageHash or imageUrl) to ingest.
 *
 * Gated behind ASSET_INGESTION_ENABLED — a no-op when disabled. Lives in its
 * own module (importing only db + flags) so structural sync can call it
 * without creating an import cycle with the ingest worker.
 */

import { db } from "@/lib/db";
import {
  InsightEntity,
  IngestionJobStatus,
  CreativeAssetKind,
} from "@prisma/client";
import { isIngestionEnabled } from "./flags";

const SPEND_WINDOW_DAYS = 30;

/**
 * Queues image-ingestion jobs for qualifying creatives on a connection.
 * Returns the number of jobs inserted (0 when disabled or nothing qualifies).
 */
export async function enqueueImageIngestionForConnection(
  connectionId: string,
): Promise<number> {
  if (!isIngestionEnabled()) return 0;

  // All ads on this connection that carry a creative, with their status.
  const ads = await db.ad.findMany({
    where: {
      creativeId: { not: null },
      adSet: { campaign: { adAccountConnectionId: connectionId } },
    },
    select: { id: true, creativeId: true, effectiveStatus: true },
  });
  if (ads.length === 0) return 0;

  const candidates = new Set<string>();

  // (1) Active ads → their creatives qualify immediately.
  const adIdToCreative = new Map<string, string>();
  for (const ad of ads) {
    if (!ad.creativeId) continue;
    adIdToCreative.set(ad.id, ad.creativeId);
    if ((ad.effectiveStatus ?? "").toUpperCase() === "ACTIVE") {
      candidates.add(ad.creativeId);
    }
  }

  // (2) Ads with spend>0 in the trailing window → their creatives qualify.
  const cutoff = new Date(Date.now() - SPEND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const adIds = Array.from(adIdToCreative.keys());
  if (adIds.length > 0) {
    const spendRows = await db.insightsDaily.findMany({
      where: {
        entityType: InsightEntity.AD,
        entityId: { in: adIds },
        date: { gte: cutoff },
        spend: { gt: 0 },
      },
      select: { entityId: true },
      distinct: ["entityId"],
    });
    for (const row of spendRows) {
      const creativeId = adIdToCreative.get(row.entityId);
      if (creativeId) candidates.add(creativeId);
    }
  }

  if (candidates.size === 0) return 0;

  // Keep only creatives that actually have an image source to ingest.
  const ingestable = await db.creative.findMany({
    where: {
      id: { in: Array.from(candidates) },
      OR: [{ imageHash: { not: null } }, { imageUrl: { not: null } }],
    },
    select: { id: true },
  });
  const ingestableIds = ingestable.map((c) => c.id);
  if (ingestableIds.length === 0) return 0;

  // Skip creatives that already have an in-flight or completed IMAGE job.
  // (FAILED jobs are allowed to re-enqueue on a later sync for retry.)
  const existing = await db.ingestionJob.findMany({
    where: {
      kind: CreativeAssetKind.IMAGE,
      creativeId: { in: ingestableIds },
      status: {
        in: [
          IngestionJobStatus.PENDING,
          IngestionJobStatus.RUNNING,
          IngestionJobStatus.DONE,
        ],
      },
    },
    select: { creativeId: true },
  });
  const blocked = new Set(existing.map((j) => j.creativeId));

  const toInsert = ingestableIds.filter((id) => !blocked.has(id));
  if (toInsert.length === 0) return 0;

  await db.ingestionJob.createMany({
    data: toInsert.map((creativeId) => ({
      creativeId,
      kind: CreativeAssetKind.IMAGE,
      status: IngestionJobStatus.PENDING,
    })),
  });

  console.log(
    `[assets] enqueued ${toInsert.length} IMAGE ingestion job(s) for connection ${connectionId}`,
  );
  return toInsert.length;
}

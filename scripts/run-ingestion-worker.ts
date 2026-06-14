/**
 * run-ingestion-worker.ts
 *
 * Drains PENDING creative-asset IngestionJob rows (kind=IMAGE) with bounded
 * concurrency, calling the exported ingestImageForCreative() from
 * src/lib/assets/ingest.ts. Each job is marked DONE on success, or retried
 * with exponential backoff and finally FAILED after MAX_ATTEMPTS.
 *
 * The ENTIRE pipeline is gated behind ASSET_INGESTION_ENABLED (default false).
 * When disabled this worker is a no-op, mirroring the structural-sync enqueue
 * hook.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/run-ingestion-worker.ts
 *
 * Requires the same environment as the app (DATABASE_URL, token encryption
 * key, ASSET_STORAGE_DRIVER, ASSET_LOCAL_DIR, ASSET_INGESTION_ENABLED).
 */
import { db } from "../src/lib/db";
import { isIngestionEnabled } from "../src/lib/assets/flags";
import { ingestImageForCreative } from "../src/lib/assets/ingest";
import { CreativeAssetKind, IngestionJobStatus } from "@prisma/client";

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff (1s, 2s, 4s, ...) capped at 30s. */
function backoffMs(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

interface ClaimedJob {
  id: string;
  creativeId: string;
  attempts: number;
}

/**
 * Atomically transitions a PENDING job to RUNNING. Returns false if another
 * worker already claimed it.
 */
async function claim(jobId: string): Promise<boolean> {
  const res = await db.ingestionJob.updateMany({
    where: { id: jobId, status: IngestionJobStatus.PENDING },
    data: { status: IngestionJobStatus.RUNNING },
  });
  return res.count === 1;
}

async function processJob(job: ClaimedJob): Promise<void> {
  if (!(await claim(job.id))) return; // taken by someone else

  try {
    await ingestImageForCreative(job.creativeId);
    await db.ingestionJob.update({
      where: { id: job.id },
      data: { status: IngestionJobStatus.DONE, lastError: null },
    });
    console.log(`[worker] DONE job ${job.id} (creative ${job.creativeId})`);
  } catch (err) {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (attempts < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempts));
      await db.ingestionJob.update({
        where: { id: job.id },
        data: {
          status: IngestionJobStatus.PENDING,
          attempts,
          lastError: message.slice(0, 1000),
        },
      });
      console.warn(
        `[worker] retry job ${job.id} (attempt ${attempts}/${MAX_ATTEMPTS}): ${message}`,
      );
    } else {
      await db.ingestionJob.update({
        where: { id: job.id },
        data: {
          status: IngestionJobStatus.FAILED,
          attempts,
          lastError: message.slice(0, 1000),
        },
      });
      console.error(
        `[worker] FAILED job ${job.id} after ${attempts} attempts: ${message}`,
      );
    }
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

async function main(): Promise<void> {
  if (!isIngestionEnabled()) {
    console.log(
      "[worker] ASSET_INGESTION_ENABLED is not 'true' — ingestion disabled, exiting (no-op).",
    );
    return;
  }

  // One-time reclaim: jobs left RUNNING by a previously-killed worker are
  // stranded (no live worker owns them). Reset any that have not been touched
  // for STALE_RUNNING_MS back to PENDING so this run can retry them.
  const STALE_RUNNING_MS = 10 * 60 * 1000; // 10 minutes
  const reclaimed = await db.ingestionJob.updateMany({
    where: {
      status: IngestionJobStatus.RUNNING,
      kind: CreativeAssetKind.IMAGE,
      updatedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) },
    },
    data: { status: IngestionJobStatus.PENDING },
  });
  if (reclaimed.count > 0) {
    console.log(
      `[worker] reclaimed ${reclaimed.count} stranded RUNNING job(s) back to PENDING.`,
    );
  }

  let processed = 0;
  // Drain in passes until no PENDING IMAGE jobs remain.
  for (;;) {
    const batch = await db.ingestionJob.findMany({
      where: {
        status: IngestionJobStatus.PENDING,
        kind: CreativeAssetKind.IMAGE,
      },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
      select: { id: true, creativeId: true, attempts: true },
    });
    if (batch.length === 0) break;

    await runPool(batch, CONCURRENCY, processJob);
    processed += batch.length;
  }

  console.log(`[worker] drained — ${processed} job(s) processed this run.`);
}

main()
  .catch((err) => {
    console.error("[worker] fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

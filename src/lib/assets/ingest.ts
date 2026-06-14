/**
 * Creative-asset image ingestion (V3 — Step 1, local storage).
 *
 * `ingestImageForCreative(creativeId)` mirrors the full-resolution image for a
 * single creative into the configured storage driver and records a
 * CreativeAsset(kind=IMAGE) row. It is idempotent per (creativeId, IMAGE):
 * re-running re-resolves and re-stores under the same storageKey.
 *
 * Hardening (reused from the creative-bundle export): hard fetch timeout,
 * size cap, and a free-space floor checked BEFORE writing. cdnUrl is never
 * set in Step 1 — it is reserved for a future S3/CDN driver.
 */

import { createHash } from "node:crypto";
import { statfs } from "node:fs/promises";
import { db } from "@/lib/db";
import { getMetaClient } from "@/lib/meta/sync";
import { CreativeAssetKind, CreativeAssetStatus } from "@prisma/client";
import { buildStorageKey, getStorageDriver } from "./storage";

const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // 8MB
// Skip writing (and mark FAILED) when the volume has less than this free.
const MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB

const CONTENT_TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/avif": "avif",
};

function extFromContentType(contentType: string | null): string {
  if (!contentType) return "jpg";
  const base = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[base] ?? "jpg";
}

function mimeFromContentType(contentType: string | null): string {
  if (!contentType) return "image/jpeg";
  return contentType.split(";")[0].trim().toLowerCase() || "image/jpeg";
}

interface DownloadedImage {
  bytes: Buffer;
  ext: string;
  mimeType: string;
}

/**
 * Downloads an image with a hard timeout and size cap. Returns null on any
 * failure (timeout, non-2xx, oversize, network error).
 */
async function downloadImage(url: string): Promise<DownloadedImage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > IMAGE_MAX_BYTES) return null;

    const data = await res.arrayBuffer();
    if (data.byteLength > IMAGE_MAX_BYTES) return null;

    const contentType = res.headers.get("content-type");
    return {
      bytes: Buffer.from(data),
      ext: extFromContentType(contentType),
      mimeType: mimeFromContentType(contentType),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Free bytes on the volume backing `dir`. Returns null if it cannot be read. */
async function freeBytes(dir: string): Promise<number | null> {
  try {
    const fs = await statfs(dir);
    return Number(fs.bavail) * Number(fs.bsize);
  } catch {
    return null;
  }
}

class IngestError extends Error {}

/**
 * Ingests the IMAGE asset for a single creative. Idempotent per
 * (creativeId, IMAGE). Throws on failure after recording the failure on the
 * CreativeAsset row, so the worker can apply backoff.
 */
export async function ingestImageForCreative(
  creativeId: string,
): Promise<void> {
  // (a) Load creative + its connection (for client id, account id, token).
  const creative = await db.creative.findUnique({
    where: { id: creativeId },
    select: {
      id: true,
      imageHash: true,
      imageUrl: true,
      adAccountConnectionId: true,
      adAccountConnection: {
        select: { clientId: true, platformAccountId: true },
      },
    },
  });
  if (!creative) throw new Error(`Creative ${creativeId} not found`);

  const clientId = creative.adAccountConnection.clientId;

  // Ensure the asset row exists up front so we always have an id to key the
  // storageKey and to record failures against (idempotent on re-run).
  const asset = await db.creativeAsset.upsert({
    where: {
      creativeId_kind: { creativeId, kind: CreativeAssetKind.IMAGE },
    },
    create: {
      creativeId,
      kind: CreativeAssetKind.IMAGE,
      status: CreativeAssetStatus.RESOLVING,
    },
    update: { status: CreativeAssetStatus.RESOLVING },
    select: { id: true },
  });

  try {
    // (b) Resolve best source: prefer adimages permalink_url for the hash,
    // then its url, then the creative's stored imageUrl.
    let sourceUrl: string | null = null;
    let resolvedWidth: number | null = null;
    let resolvedHeight: number | null = null;

    if (creative.imageHash) {
      const ctx = await getMetaClient(creative.adAccountConnectionId);
      if (ctx) {
        const images = await ctx.meta.resolveAdImages(
          creative.adAccountConnection.platformAccountId,
          [creative.imageHash],
        );
        const match =
          images.find((img) => img.hash === creative.imageHash) ?? images[0];
        if (match) {
          sourceUrl = match.permalink_url ?? match.url ?? null;
          resolvedWidth = match.width ?? null;
          resolvedHeight = match.height ?? null;
        }
      }
    }
    if (!sourceUrl) sourceUrl = creative.imageUrl ?? null;

    if (!sourceUrl) {
      // Nothing to fetch from — mark UNAVAILABLE (not a transient failure).
      await db.creativeAsset.update({
        where: { id: asset.id },
        data: {
          status: CreativeAssetStatus.UNAVAILABLE,
          sourceUrl: null,
          resolvedAt: new Date(),
          lastError: "no source URL (missing imageHash/imageUrl)",
        },
      });
      throw new IngestError("no source URL for creative image");
    }

    await db.creativeAsset.update({
      where: { id: asset.id },
      data: {
        status: CreativeAssetStatus.FETCHING,
        sourceUrl,
        resolvedAt: new Date(),
      },
    });

    // (c) Download bytes with hard timeout + size cap.
    const image = await downloadImage(sourceUrl);
    if (!image) {
      throw new IngestError(`image download failed for ${sourceUrl}`);
    }

    // (d) Free-space floor — check BEFORE writing.
    const driver = getStorageDriver();
    const baseDir = process.env.ASSET_LOCAL_DIR;
    if (baseDir) {
      const free = await freeBytes(baseDir);
      if (free !== null && free < MIN_FREE_BYTES) {
        // Skip the write; the catch block records FAILED + attempts + error.
        throw new IngestError(
          `insufficient disk space (${free} bytes free, floor ${MIN_FREE_BYTES}) — skipped write`,
        );
      }
    }

    // (e) Persist to the driver and record the asset as READY.
    const storageKey = buildStorageKey(
      clientId,
      creativeId,
      asset.id,
      image.ext,
    );
    const contentHash = createHash("sha256").update(image.bytes).digest("hex");

    await driver.put(storageKey, image.bytes, image.mimeType);

    await db.creativeAsset.update({
      where: { id: asset.id },
      data: {
        status: CreativeAssetStatus.READY,
        storageKey,
        width: resolvedWidth,
        height: resolvedHeight,
        bytes: image.bytes.byteLength,
        mimeType: image.mimeType,
        contentHash,
        storedAt: new Date(),
        lastError: null,
        // cdnUrl intentionally left null (reserved for a future CDN driver).
      },
    });
  } catch (err) {
    // (f) Record the failure. UNAVAILABLE is terminal and already persisted
    // above; only overwrite for transient/unexpected failures.
    const message = err instanceof Error ? err.message : String(err);
    const current = await db.creativeAsset.findUnique({
      where: { id: asset.id },
      select: { status: true },
    });
    if (current?.status !== CreativeAssetStatus.UNAVAILABLE) {
      await db.creativeAsset.update({
        where: { id: asset.id },
        data: {
          status: CreativeAssetStatus.FAILED,
          attempts: { increment: 1 },
          lastError: message.slice(0, 1000),
        },
      });
    }
    throw err;
  }
}

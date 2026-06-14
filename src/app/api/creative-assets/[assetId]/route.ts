/**
 * Authenticated creative-asset serving route.
 *
 * GET /api/creative-assets/[assetId]
 *
 * The local asset directory is private and never statically exposed — stored
 * media is served ONLY through this route. Access is enforced with the same
 * getAccessibleClientIds(user) rule used everywhere else. To avoid leaking the
 * existence of assets the caller may not see, any access failure (unknown
 * asset, no permission, not yet READY) returns 404 — never 403.
 *
 * SECURITY: no path from the URL ever touches the filesystem. Only the stored
 * `storageKey` (which the storage driver re-validates against its base dir) is
 * used to open the file.
 */

import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { getStorageDriver } from "@/lib/assets/storage";
import { CreativeAssetStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { assetId: string } },
): Promise<Response> {
  // --- Authentication ------------------------------------------------------
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // --- Load asset → creative → connection → client -------------------------
  const asset = await db.creativeAsset.findUnique({
    where: { id: params.assetId },
    select: {
      status: true,
      storageKey: true,
      mimeType: true,
      bytes: true,
      creative: {
        select: { adAccountConnection: { select: { clientId: true } } },
      },
    },
  });

  // Not found, not ready, or missing stored object → 404 (never 403/leak).
  if (
    !asset ||
    asset.status !== CreativeAssetStatus.READY ||
    !asset.storageKey
  ) {
    return notFound();
  }

  // --- Access control ------------------------------------------------------
  const clientId = asset.creative.adAccountConnection.clientId;
  const accessibleClientIds = await getAccessibleClientIds(user);
  if (!accessibleClientIds.includes(clientId)) {
    return notFound();
  }

  // --- Stream the stored file ---------------------------------------------
  const driver = getStorageDriver();
  let stream;
  try {
    stream = await driver.getStream(asset.storageKey);
  } catch {
    // File recorded as READY but missing/unreadable on disk.
    return notFound();
  }

  const headers = new Headers({
    "Content-Type": asset.mimeType ?? "application/octet-stream",
    "Cache-Control": "private, max-age=300",
  });
  if (asset.bytes != null) {
    headers.set("Content-Length", String(asset.bytes));
  }

  const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}

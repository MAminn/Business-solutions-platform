import { subDays, format } from "date-fns";
import JSZip from "jszip";
import type { NextRequest } from "next/server";
import type { CreativeType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";

// ============================================================================
// Per-connection creative bundle export.
//
// Streams a ZIP containing creatives.md (aggregated 30-day, ad-level
// performance per creative) plus the creative images downloaded server-side
// from Meta's CDN. Mirrors the requireUser()/getAccessibleClientIds()
// access-control pattern used in src/server/digest.ts and the ad-level
// insight aggregation from src/app/(app)/clients/[id]/creatives/page.tsx.
//
// Revenue / ROAS / CPA are Meta-reported and not reconciled against real
// sales — the manifest states this explicitly.
// ============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;
const MAX_CREATIVES = 25;
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // 8MB

const IMAGE_UNAVAILABLE_NOTE =
  "image unavailable — Meta CDN URL likely expired; run Sync Now and re-export";

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function pct(value: number, digits = 2): string {
  return `${value.toFixed(digits)}%`;
}

function plainText(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Collapse newlines so stored copy cannot break a Markdown list item. */
function inline(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function safeFileToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

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

/**
 * Downloads a creative image with a hard timeout and size cap.
 * Returns null on any failure (timeout, non-2xx, oversize, network error).
 */
async function downloadImage(
  url: string,
): Promise<{ data: ArrayBuffer; ext: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > IMAGE_MAX_BYTES) return null;

    const data = await res.arrayBuffer();
    if (data.byteLength > IMAGE_MAX_BYTES) return null;

    return { data, ext: extFromContentType(res.headers.get("content-type")) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface CreativeAgg {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  conversionValue: number;
  freqSum: number;
  freqCount: number;
  videoViews3s: number;
  videoViewsP25: number;
  videoViewsP50: number;
  videoViewsP75: number;
  videoViewsP100: number;
}

function emptyAgg(): CreativeAgg {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    purchases: 0,
    conversionValue: 0,
    freqSum: 0,
    freqCount: 0,
    videoViews3s: 0,
    videoViewsP25: 0,
    videoViewsP50: 0,
    videoViewsP75: 0,
    videoViewsP100: 0,
  };
}

interface SelectedCreative {
  id: string;
  platformId: string;
  name: string;
  type: CreativeType;
  headline: string | null;
  bodyText: string | null;
  callToAction: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  adNames: string[];
  adCount: number;
  agg: CreativeAgg;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { connectionId: string } },
): Promise<Response> {
  // --- Authentication ------------------------------------------------------
  let user;
  try {
    user = await requireUser();
  } catch {
    return plainText(403, "Forbidden");
  }

  // --- Load connection -----------------------------------------------------
  const conn = await db.adAccountConnection.findUnique({
    where: { id: params.connectionId },
    select: {
      id: true,
      clientId: true,
      accountName: true,
      platformAccountId: true,
      currency: true,
      insightsBackfilledAt: true,
      client: { select: { name: true } },
    },
  });
  if (!conn) {
    return plainText(404, "Connection not found");
  }

  // --- Authorization -------------------------------------------------------
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(conn.clientId)) {
    return plainText(403, "Forbidden");
  }

  // --- Hard block: require a completed 30-day insights backfill ------------
  if (!conn.insightsBackfilledAt) {
    return plainText(
      409,
      "This ad account has no completed 30-day insights backfill yet, so a " +
        "digest/bundle cannot be trusted. Run Sync Now and wait for the " +
        "backfill to finish before exporting a creative bundle.",
    );
  }

  // --- Load creatives + linked ads -----------------------------------------
  const creatives = await db.creative.findMany({
    where: { adAccountConnectionId: conn.id },
    select: {
      id: true,
      platformId: true,
      name: true,
      type: true,
      thumbnailUrl: true,
      imageUrl: true,
      headline: true,
      bodyText: true,
      callToAction: true,
      ads: { select: { id: true, name: true } },
    },
  });

  // --- 30 days of ad-level insights, aggregated per ad ----------------------
  const now = new Date();
  const windowStart = subDays(now, WINDOW_DAYS);
  const adIds = creatives.flatMap((c) => c.ads.map((a) => a.id));

  const insightsByAd = new Map<string, CreativeAgg>();
  if (adIds.length > 0) {
    const rows = await db.insightsDaily.findMany({
      where: {
        entityType: "AD",
        entityId: { in: adIds },
        date: { gte: windowStart },
      },
      select: {
        entityId: true,
        spend: true,
        impressions: true,
        clicks: true,
        purchases: true,
        conversionValue: true,
        frequency: true,
        videoViews3s: true,
        videoViewsP25: true,
        videoViewsP50: true,
        videoViewsP75: true,
        videoViewsP100: true,
      },
    });
    for (const r of rows) {
      const cur = insightsByAd.get(r.entityId) ?? emptyAgg();
      cur.spend += num(r.spend);
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.purchases += r.purchases;
      cur.conversionValue += num(r.conversionValue);
      if (r.frequency !== null) {
        cur.freqSum += num(r.frequency);
        cur.freqCount += 1;
      }
      cur.videoViews3s += r.videoViews3s ?? 0;
      cur.videoViewsP25 += r.videoViewsP25 ?? 0;
      cur.videoViewsP50 += r.videoViewsP50 ?? 0;
      cur.videoViewsP75 += r.videoViewsP75 ?? 0;
      cur.videoViewsP100 += r.videoViewsP100 ?? 0;
      insightsByAd.set(r.entityId, cur);
    }
  }

  // --- Aggregate per creative across its linked ads -------------------------
  const perCreative: SelectedCreative[] = creatives.map((cr) => {
    const agg = emptyAgg();
    for (const ad of cr.ads) {
      const adAgg = insightsByAd.get(ad.id);
      if (!adAgg) continue;
      agg.spend += adAgg.spend;
      agg.impressions += adAgg.impressions;
      agg.clicks += adAgg.clicks;
      agg.purchases += adAgg.purchases;
      agg.conversionValue += adAgg.conversionValue;
      agg.freqSum += adAgg.freqSum;
      agg.freqCount += adAgg.freqCount;
      agg.videoViews3s += adAgg.videoViews3s;
      agg.videoViewsP25 += adAgg.videoViewsP25;
      agg.videoViewsP50 += adAgg.videoViewsP50;
      agg.videoViewsP75 += adAgg.videoViewsP75;
      agg.videoViewsP100 += adAgg.videoViewsP100;
    }
    return {
      id: cr.id,
      platformId: cr.platformId,
      name: cr.name,
      type: cr.type,
      headline: cr.headline,
      bodyText: cr.bodyText,
      callToAction: cr.callToAction,
      imageUrl: cr.imageUrl,
      thumbnailUrl: cr.thumbnailUrl,
      adNames: cr.ads.map((a) => a.name),
      adCount: cr.ads.length,
      agg,
    };
  });

  // Spenders only, sorted by 30-day spend descending, capped.
  const selected = perCreative
    .filter((c) => c.agg.spend > 0)
    .sort((a, b) => b.agg.spend - a.agg.spend)
    .slice(0, MAX_CREATIVES);

  // --- Download images server-side ------------------------------------------
  const zip = new JSZip();
  const imageFileByCreative = new Map<string, string>();
  for (let i = 0; i < selected.length; i++) {
    const cr = selected[i];
    const url = cr.imageUrl ?? cr.thumbnailUrl;
    if (!url) continue;
    const result = await downloadImage(url);
    if (!result) continue;
    const filename = `images/${i + 1}-${safeFileToken(cr.platformId)}.${result.ext}`;
    zip.file(filename, result.data);
    imageFileByCreative.set(cr.id, filename);
  }

  // --- Build creatives.md ----------------------------------------------------
  const lines: string[] = [];
  lines.push(`# Creative bundle — ${conn.accountName}`);
  lines.push("");
  lines.push(`- **Client:** ${conn.client.name}`);
  lines.push(`- **Account:** ${conn.accountName} (${conn.platformAccountId})`);
  lines.push(`- **Currency:** ${conn.currency}`);
  lines.push(
    `- **Date window:** ${format(windowStart, "yyyy-MM-dd")} → ` +
      `${format(now, "yyyy-MM-dd")} (last ${WINDOW_DAYS} days)`,
  );
  lines.push(`- **Generated at:** ${format(now, "yyyy-MM-dd HH:mm")}`);
  lines.push("");
  lines.push(
    "> Revenue, ROAS, and CPA are Meta-reported and not reconciled against real sales.",
  );
  lines.push("");

  if (selected.length === 0) {
    lines.push(`_No creatives with spend in the last ${WINDOW_DAYS} days._`);
  }

  selected.forEach((cr, i) => {
    const a = cr.agg;
    const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
    const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
    const cpa = a.purchases > 0 ? a.spend / a.purchases : 0;
    const roas = a.spend > 0 ? a.conversionValue / a.spend : 0;
    const freq = a.freqCount > 0 ? a.freqSum / a.freqCount : 0;

    lines.push(`## ${i + 1}. ${inline(cr.name)}`);
    lines.push("");
    lines.push(`- **Type:** ${cr.type}`);
    lines.push(`- **Headline:** ${cr.headline ? inline(cr.headline) : "—"}`);
    lines.push(`- **Body text:** ${cr.bodyText ? inline(cr.bodyText) : "—"}`);
    lines.push(`- **CTA:** ${cr.callToAction ? inline(cr.callToAction) : "—"}`);
    const shownAds = cr.adNames.slice(0, 3).map(inline).join(", ");
    lines.push(
      `- **Linked ads:** ${cr.adCount}` + (shownAds ? ` (${shownAds})` : ""),
    );
    lines.push(`- **Spend:** ${money(a.spend, conn.currency)}`);
    lines.push(`- **Impressions:** ${a.impressions.toLocaleString("en-US")}`);
    lines.push(`- **Clicks:** ${a.clicks.toLocaleString("en-US")}`);
    lines.push(`- **CTR:** ${pct(ctr)}`);
    lines.push(`- **CPM:** ${money(cpm, conn.currency)}`);
    lines.push(`- **Purchases:** ${a.purchases.toLocaleString("en-US")}`);
    lines.push(
      `- **Meta CPA:** ${a.purchases > 0 ? money(cpa, conn.currency) : "n/a (no purchases)"}`,
    );
    lines.push(`- **Meta ROAS:** ${roas.toFixed(2)}x`);
    lines.push(`- **Avg frequency:** ${freq.toFixed(2)}`);

    if (cr.type === "VIDEO") {
      const hookRate =
        a.impressions > 0 ? (a.videoViews3s / a.impressions) * 100 : 0;
      lines.push(`- **Hook rate (3s views / impressions):** ${pct(hookRate)}`);
      const retention = (views: number): string =>
        a.videoViews3s > 0 ? pct((views / a.videoViews3s) * 100, 1) : "n/a";
      lines.push(
        `- **Retention:** p25 ${retention(a.videoViewsP25)} · ` +
          `p50 ${retention(a.videoViewsP50)} · ` +
          `p75 ${retention(a.videoViewsP75)} · ` +
          `p100 ${retention(a.videoViewsP100)} (of 3s views)`,
      );
    }

    const imageFile = imageFileByCreative.get(cr.id);
    lines.push(`- **Image:** ${imageFile ?? IMAGE_UNAVAILABLE_NOTE}`);

    if (cr.type === "VIDEO") {
      lines.push("");
      lines.push(
        "_Video file not included — analysis basis is thumbnail, copy, and retention funnel only._",
      );
    }
    lines.push("");
  });

  zip.file("creatives.md", lines.join("\n"));

  // --- Stream the ZIP --------------------------------------------------------
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const zipName = `creative-bundle-${safeFileToken(conn.accountName)}-${format(now, "yyyy-MM-dd")}.zip`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

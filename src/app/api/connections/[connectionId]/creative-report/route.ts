import { subDays, format } from "date-fns";
import type { NextRequest } from "next/server";
import {
  AdPlatform,
  CreativeAssetKind,
  CreativeAssetStatus,
} from "@prisma/client";
import type { CreativeType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { getStorageDriver } from "@/lib/assets/storage";
import {
  renderCreativeReportPdf,
  TOP_CREATIVE_CARDS,
  VERDICTS,
} from "@/server/creative-report-doc";
import type {
  CreativeReportData,
  CreativeReportRow,
  Verdict,
} from "@/server/creative-report-doc";

// ============================================================================
// Per-connection "Creative Analysis Report" PDF export.
//
// Aggregates already-synced ad-level InsightsDaily rows per creative over the
// last 30 days, derives a per-creative verdict, and renders a branded PDF via
// @react-pdf/renderer. Read-only: no Meta API calls, no writes.
//
// Mirrors the requireUser()/getAccessibleClientIds() access-control pattern
// and the insightsBackfilledAt hard-block used in the creative-bundle route.
// The read shape is replicated locally (no import from the bundle route).
//
// Revenue / ROAS / CPA are Meta-reported and not reconciled against real
// sales — the report states this explicitly.
//
// The one exception to "no network calls" is the best-effort creative-image
// resolution used to illustrate the top cards (stored asset bytes first, then
// the Meta image / thumbnail URLs). It is failure-isolated at every step: an
// unresolvable image degrades that one card to the NO IMAGE box and never
// fails the export.
// ============================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

// Verdict thresholds (clearly named).
// A creative counts as "top spend-share" when it carries at least this
// fraction of the account's total 30-day spend.
const SCALE_MIN_SPEND_SHARE = 0.05;
// A creative at this many times the account-median ROAS is an efficiency
// standout worth scaling even when it sits below the spend-share floor.
// Loosened to 1.2x so genuine high-efficiency, lower-spend winners that sit
// just above the median clear the efficiency Scale bar.
const SCALE_ROAS_MEDIAN_MULT = 1.2;
// Minimum purchases for the efficiency Scale path, so a single-conversion
// blip on a high-ROAS, low-spend creative can't qualify as Scale.
const SCALE_MIN_PURCHASES = 3;
// Minimum spend (account currency, EGP for Mach) before a zero-purchase
// creative is called a "Kill". Below this floor the spend is treated as
// trivial wind-down and the creative falls through to Hold/Watch (or Refresh
// if fatigued) instead. Conservative default — tune against the real spend
// distribution once the DB is reachable.
const KILL_MIN_SPEND = 250;
// Minimum usable (stable) daily data points before a fatigue trend is called.
const FATIGUE_MIN_USABLE_DAYS = 4;
// Number of most-recent days dropped from the fatigue trend (see isFatigued).
const FATIGUE_STALE_TRAILING_DAYS = 2;

// ---------------------------------------------------------------------------
// Creative image resolution (report illustration only)
// ---------------------------------------------------------------------------

// Hard timeout / size cap mirror the creative-bundle + ingestion downloads.
const IMAGE_FETCH_TIMEOUT_MS = 10_000;
// Cap on the bytes embedded per card. Data-URI encoding inflates by ~4/3, so
// this bounds the PDF at roughly 4MB of image payload across the cards.
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
// Bounded parallelism so the cards do not resolve serially behind N timeouts.
const IMAGE_RESOLVE_CONCURRENCY = 4;

interface ImageSource {
  storageKey: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
}

/**
 * Sniffs the real image format from the leading magic bytes and returns the
 * MIME type, or null when the bytes are neither JPEG nor PNG.
 *
 * @react-pdf/renderer only embeds JPEG and PNG — handing it WEBP/GIF/AVIF (or
 * an HTML error page served with an image content-type) throws during render
 * and would take the whole PDF down. The declared Content-Type is not trusted;
 * only the bytes are.
 */
function sniffPdfSafeMime(bytes: Buffer): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/** Encodes verified image bytes as a data URI @react-pdf/renderer can embed. */
function toDataUri(bytes: Buffer): string | null {
  const mime = sniffPdfSafeMime(bytes);
  if (!mime) return null;
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * Reads a stored creative asset directly off the storage driver.
 *
 * Deliberately NOT through GET /api/creative-assets/[assetId]: that route is
 * session-authenticated and a server-side self-call would carry no session.
 * The equivalent access control is already satisfied here — the caller was
 * authorized for this connection's client before we reached this point, and
 * the driver re-validates the storageKey against its base directory.
 *
 * Returns null on any failure (missing/unreadable object, oversize).
 */
async function readStoredAssetBytes(
  storageKey: string,
): Promise<Buffer | null> {
  try {
    const stream = await getStorageDriver().getStream(storageKey);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.from(chunk);
      total += buf.length;
      if (total > IMAGE_MAX_BYTES) {
        stream.destroy();
        return null;
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

/**
 * Downloads an image with a hard timeout and size cap. Returns null on any
 * failure (timeout, non-2xx, oversize, network error).
 */
async function downloadImage(url: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;

    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > IMAGE_MAX_BYTES) return null;

    const data = await res.arrayBuffer();
    if (data.byteLength > IMAGE_MAX_BYTES) return null;

    return Buffer.from(data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves one usable card image for a creative, in priority order:
 *   1. a READY CreativeAsset(kind=IMAGE), read straight from storage,
 *   2. the full-resolution imageUrl,
 *   3. the thumbnailUrl.
 *
 * VIDEO creatives take the same path — their thumbnail is the expected report
 * image. videoUrl is never fetched or embedded.
 *
 * Returns null only when every available source fails or yields bytes that are
 * not PDF-embeddable; that null is what makes the card show NO IMAGE.
 */
async function resolveCreativeImage(
  source: ImageSource,
): Promise<string | null> {
  if (source.storageKey) {
    const stored = await readStoredAssetBytes(source.storageKey);
    if (stored) {
      const uri = toDataUri(stored);
      if (uri) return uri;
    }
  }
  for (const url of [source.imageUrl, source.thumbnailUrl]) {
    if (!url) continue;
    const bytes = await downloadImage(url);
    if (!bytes) continue;
    const uri = toDataUri(bytes);
    if (uri) return uri;
  }
  return null;
}

/**
 * Resolves images for every task with bounded parallelism, writing each result
 * onto the target row. Each task is individually failure-isolated, so the
 * export proceeds even if all of them fail.
 */
async function resolveImagesInto(
  tasks: Array<{ target: CreativeReportRow; source: ImageSource }>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      const task = tasks[index];
      try {
        task.target.imageDataUri = await resolveCreativeImage(task.source);
      } catch {
        // A single unresolvable image must never fail the whole PDF export.
        task.target.imageDataUri = null;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(IMAGE_RESOLVE_CONCURRENCY, tasks.length) },
      worker,
    ),
  );
}

function plainText(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function fmtDay(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

/**
 * Display-only cleanup of a creative name: trims a trailing platform-ID token
 * (a separator followed by a long hex/alphanumeric hash, and any date token
 * left behind), e.g. "My Ad - 2026-05-01 - a1b2c3d4e5" -> "My Ad".
 * Conservative: when the trailing pattern is absent the name is returned
 * unchanged. Never mutates stored data.
 */
function cleanCreativeName(name: string): string {
  const cleaned = name
    .replace(/\s*[-–|]\s*[0-9a-f]{8,}\s*$/i, "") // trailing hex hash tail
    .replace(/\s*[-–|]\s*\d{4}-\d{2}-\d{2}\s*$/i, "") // trailing date token
    .trim();
  return cleaned.length > 0 ? cleaned : name;
}

// ---------------------------------------------------------------------------
// Per-creative aggregation (read shape replicated locally).
// ---------------------------------------------------------------------------

interface CreativeAgg {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  conversionValue: number;
  freqSum: number;
  freqCount: number;
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
  };
}

// Daily {date, ctr, frequency} point for a creative (stored values, averaged
// across that creative's ads on a given day — never recomputed from
// clicks/impressions).
interface DayPoint {
  date: Date;
  ctr: number | null;
  frequency: number | null;
}

/**
 * Fatigue trend — logic identical to isFatigued() in src/server/digest.ts:
 * sort by date, drop the 2 most recent dates, use stored ctr/frequency
 * directly, require >= 4 usable days, flag when second-half avg CTR is below
 * first-half AND second-half avg frequency is above first-half.
 *
 * The 2 most recent days are excluded because the sync upsert update-branch
 * does not refresh ctr/frequency on re-pulled trailing days, so those points
 * are stale and would distort the trend.
 */
function isFatigued(series: DayPoint[]): boolean {
  const sorted = [...series].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  // Drop the 2 most recent dates (stale on re-pull).
  const stable = sorted.slice(
    0,
    Math.max(0, sorted.length - FATIGUE_STALE_TRAILING_DAYS),
  );
  const usable = stable.filter(
    (d) => d.ctr !== null && d.frequency !== null,
  ) as Array<{ date: Date; ctr: number; frequency: number }>;
  if (usable.length < FATIGUE_MIN_USABLE_DAYS) return false;

  const mid = Math.floor(usable.length / 2);
  const firstHalf = usable.slice(0, mid);
  const secondHalf = usable.slice(mid);

  const avg = (
    arr: Array<{ ctr: number; frequency: number }>,
    key: "ctr" | "frequency",
  ): number => arr.reduce((acc, d) => acc + d[key], 0) / arr.length;

  const ctrFirst = avg(firstHalf, "ctr");
  const ctrSecond = avg(secondHalf, "ctr");
  const freqFirst = avg(firstHalf, "frequency");
  const freqSecond = avg(secondHalf, "frequency");

  const ctrDeclining = ctrSecond < ctrFirst;
  const freqRising = freqSecond > freqFirst;
  return ctrDeclining && freqRising;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

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
      platform: true,
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

  // --- Platform guard: the report is Meta-only -----------------------------
  if (conn.platform !== AdPlatform.META) {
    return plainText(
      409,
      "This creative report is Meta-only and cannot be generated for a " +
        `${conn.platform} connection.`,
    );
  }

  // --- Hard block: require a completed 30-day insights backfill ------------
  if (!conn.insightsBackfilledAt) {
    return plainText(
      409,
      "This ad account has no completed 30-day insights backfill yet, so a " +
        "creative report cannot be trusted. Run Sync Now and wait for the " +
        "backfill to finish before exporting a creative report.",
    );
  }

  // --- Load creatives + linked ads -----------------------------------------
  const creatives = await db.creative.findMany({
    where: { adAccountConnectionId: conn.id },
    select: {
      id: true,
      name: true,
      type: true,
      headline: true,
      bodyText: true,
      callToAction: true,
      // Meta-hosted image sources, used as the 2nd/3rd resolution fallbacks.
      imageUrl: true,
      thumbnailUrl: true,
      // Preferred source: bytes already mirrored into local storage.
      assets: {
        where: {
          kind: CreativeAssetKind.IMAGE,
          status: CreativeAssetStatus.READY,
          storageKey: { not: null },
        },
        select: { storageKey: true },
        take: 1,
      },
      ads: { select: { id: true, name: true } },
    },
  });

  // --- 30 days of ad-level insights ----------------------------------------
  const now = new Date();
  const windowStart = subDays(now, WINDOW_DAYS);
  const adToCreative = new Map<string, string>();
  for (const cr of creatives) {
    for (const ad of cr.ads) adToCreative.set(ad.id, cr.id);
  }
  const adIds = [...adToCreative.keys()];

  const aggByCreative = new Map<string, CreativeAgg>();
  // Per creative → per day-key → accumulating stored ctr/frequency averages.
  const dailyByCreative = new Map<
    string,
    Map<
      string,
      {
        date: Date;
        ctrSum: number;
        ctrCount: number;
        freqSum: number;
        freqCount: number;
      }
    >
  >();
  let maxDate: Date | null = null;

  if (adIds.length > 0) {
    const rows = await db.insightsDaily.findMany({
      where: {
        entityType: "AD",
        entityId: { in: adIds },
        date: { gte: windowStart },
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
    });

    for (const r of rows) {
      const creativeId = adToCreative.get(r.entityId);
      if (!creativeId) continue;

      const agg = aggByCreative.get(creativeId) ?? emptyAgg();
      agg.spend += num(r.spend);
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.purchases += r.purchases;
      agg.conversionValue += num(r.conversionValue);
      if (r.frequency !== null) {
        agg.freqSum += num(r.frequency);
        agg.freqCount += 1;
      }
      aggByCreative.set(creativeId, agg);

      if (maxDate === null || r.date > maxDate) maxDate = r.date;

      const dayMap =
        dailyByCreative.get(creativeId) ??
        new Map<
          string,
          {
            date: Date;
            ctrSum: number;
            ctrCount: number;
            freqSum: number;
            freqCount: number;
          }
        >();
      const key = fmtDay(r.date);
      const point = dayMap.get(key) ?? {
        date: r.date,
        ctrSum: 0,
        ctrCount: 0,
        freqSum: 0,
        freqCount: 0,
      };
      if (r.ctr !== null) {
        point.ctrSum += num(r.ctr);
        point.ctrCount += 1;
      }
      if (r.frequency !== null) {
        point.freqSum += num(r.frequency);
        point.freqCount += 1;
      }
      dayMap.set(key, point);
      dailyByCreative.set(creativeId, dayMap);
    }
  }

  // --- Build per-creative rows (spenders only) -----------------------------
  interface Built {
    row: Omit<CreativeReportRow, "verdict">;
    spend: number;
    roas: number;
    /** Image sources; resolved later, only for the cards actually rendered. */
    imageSource: ImageSource;
  }

  const built: Built[] = [];
  for (const cr of creatives) {
    const agg = aggByCreative.get(cr.id);
    if (!agg || agg.spend <= 0) continue;

    const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    const cpm = agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0;
    const cpa = agg.purchases > 0 ? agg.spend / agg.purchases : null;
    const roas = agg.spend > 0 ? agg.conversionValue / agg.spend : 0;
    const frequency = agg.freqCount > 0 ? agg.freqSum / agg.freqCount : 0;

    const dayMap = dailyByCreative.get(cr.id);
    const series: DayPoint[] = dayMap
      ? [...dayMap.values()].map((d) => ({
          date: d.date,
          ctr: d.ctrCount > 0 ? d.ctrSum / d.ctrCount : null,
          frequency: d.freqCount > 0 ? d.freqSum / d.freqCount : null,
        }))
      : [];
    const fatigued = isFatigued(series);

    built.push({
      spend: agg.spend,
      roas,
      imageSource: {
        storageKey: cr.assets[0]?.storageKey ?? null,
        imageUrl: cr.imageUrl,
        thumbnailUrl: cr.thumbnailUrl,
      },
      row: {
        name: cleanCreativeName(cr.name),
        type: cr.type as CreativeType,
        headline: cr.headline,
        bodyText: cr.bodyText,
        callToAction: cr.callToAction,
        spend: agg.spend,
        impressions: agg.impressions,
        clicks: agg.clicks,
        ctr,
        cpm,
        cpa,
        roas,
        frequency,
        purchases: agg.purchases,
        fatigued,
      },
    });
  }

  built.sort((a, b) => b.spend - a.spend);

  // --- Verdict derivation --------------------------------------------------
  const totalSpend = built.reduce((acc, b) => acc + b.spend, 0);
  // Median ROAS across positive-ROAS spenders only → "typical performance
  // among creatives that are actually converting".
  // Zero-ROAS creatives (spend with no attributed conversion value) are
  // excluded on purpose: they are the population we're trying to separate
  // out, not a performance baseline. Including them — e.g. in a quiet
  // wind-down window where most creatives have ROAS 0 — drags the median to
  // exactly 0, which makes the SCALE_ROAS_MEDIAN_MULT multiplier meaningless
  // (roas >= 0 * 1.2 ≡ roas >= 0) and trips the medianRoas > 0 guard so the
  // efficiency Scale path never fires. If the positive subset is empty,
  // medianRoas stays 0 and that guard correctly disables the efficiency path.
  const roasSorted = built
    .map((b) => b.roas)
    .filter((roas) => roas > 0)
    .sort((a, b) => a - b);
  const medianRoas =
    roasSorted.length === 0
      ? 0
      : roasSorted.length % 2 === 1
        ? roasSorted[(roasSorted.length - 1) / 2]
        : (roasSorted[roasSorted.length / 2 - 1] +
            roasSorted[roasSorted.length / 2]) /
          2;

  function deriveVerdict(b: Built): Verdict {
    const { row } = b;
    // Kill: non-trivial spend (>= KILL_MIN_SPEND) with zero purchases.
    // Zero-purchase creatives below the floor fall through (Hold/Watch, or
    // Refresh if fatigued) rather than being flagged as wasted spend.
    if (row.spend >= KILL_MIN_SPEND && row.purchases === 0) return "Kill";
    // Refresh: a fatigue trend is present.
    if (row.fatigued) return "Refresh";
    // Scale: top spend-share AND efficiency above the median of spenders.
    const spendShare = totalSpend > 0 ? b.spend / totalSpend : 0;
    if (spendShare >= SCALE_MIN_SPEND_SHARE && b.roas > medianRoas) {
      return "Scale";
    }
    // Scale (efficiency path): a high-efficiency, lower-spend winner — well
    // above the account-median ROAS with enough purchases to be real, even
    // though it sits below the spend-share floor. Guard against a zero/absent
    // median (would make the multiple trivially clearable for everyone).
    if (
      medianRoas > 0 &&
      b.roas >= medianRoas * SCALE_ROAS_MEDIAN_MULT &&
      row.purchases >= SCALE_MIN_PURCHASES
    ) {
      return "Scale";
    }
    return "Hold/Watch";
  }

  const rows: CreativeReportRow[] = built.map((b) => ({
    ...b.row,
    verdict: deriveVerdict(b),
  }));

  // --- Creative images for the rendered cards ------------------------------
  // Only the first TOP_CREATIVE_CARDS rows get a card, so only those need an
  // image. rows[] and built[] are index-aligned (rows is a 1:1 map of the
  // already-sorted built[]). Best-effort: a row keeps imageDataUri null on
  // failure and renders the NO IMAGE box.
  await resolveImagesInto(
    rows.slice(0, TOP_CREATIVE_CARDS).map((row, i) => ({
      target: row,
      source: built[i].imageSource,
    })),
  );

  const verdictCounts = VERDICTS.reduce(
    (acc, v) => {
      acc[v] = 0;
      return acc;
    },
    {} as Record<Verdict, number>,
  );
  for (const r of rows) verdictCounts[r.verdict] += 1;

  // Spend-quality headline: share of spend wasted on Kill creatives
  // (spending with zero purchases).
  const belowThresholdSpend = rows
    .filter((r) => r.verdict === "Kill")
    .reduce((acc, r) => acc + r.spend, 0);
  const belowThresholdSpendPct =
    totalSpend > 0 ? (belowThresholdSpend / totalSpend) * 100 : 0;

  // --- Window label anchored on latest data date present -------------------
  const anchor = maxDate ?? now;
  const windowLabel = `${fmtDay(windowStart)} → ${fmtDay(anchor)} (last ${WINDOW_DAYS} days, anchored on latest data)`;

  const data: CreativeReportData = {
    clientName: conn.client.name,
    accountName: conn.accountName,
    platformAccountId: conn.platformAccountId,
    currency: conn.currency,
    windowLabel,
    generatedAtLabel: format(now, "yyyy-MM-dd HH:mm"),
    creatives: rows,
    verdictCounts,
    belowThresholdSpendPct,
    spenderCount: rows.length,
  };

  // --- Render PDF ----------------------------------------------------------
  const buffer = await renderCreativeReportPdf(data);

  const safeName =
    conn.accountName.replace(/[^a-zA-Z0-9_-]+/g, "-") || "report";
  const fileName = `creative-report-${safeName}-${format(now, "yyyy-MM-dd")}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

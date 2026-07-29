import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BreakdownDimension, InsightEntity } from "@prisma/client";
import { db } from "@/lib/db";
import {
  syncPlacementBreakdown,
  syncPublisherPlatformBreakdown,
} from "@/lib/meta/sync-breakdowns";

/**
 * Manual breakdown sync (Phase B — single-account pilot).
 *
 * Fetches ACCOUNT-level breakdown insights for ONE connection over a 30-day
 * window and writes them to `InsightsBreakdownDaily`. The entity-level insights
 * pipeline (`InsightsDaily` / `persistInsight`) is never touched.
 *
 * Modes:
 *   - ?connectionId=<id> → REQUIRED. This phase never iterates all connections.
 *   - ?dimension=<name>  → optional; `publisher_platform` (default) or
 *                          `placement` (Meta `publisher_platform,platform_position`,
 *                          stored as a pipe-delimited composite value).
 *   - ?dryRun=true       → report the plan; zero Meta calls, zero writes.
 *
 * Kill switch: disabled unless `BREAKDOWN_SYNC_ENABLED === "true"`. When
 * disabled the route returns a clear "disabled" response without calling Meta.
 * Not wired to any cron schedule.
 *
 * Auth: protected by a static bearer secret (`CRON_SECRET`), mirroring
 * `sync-all/route.ts` and `rotate-tokens/route.ts`. Fails closed when
 * `CRON_SECRET` is unset. Listed in the public matcher in `middleware.ts` so
 * the caller can reach it without a Clerk session.
 *
 * Secrets safety: token bytes and `CRON_SECRET` are never logged or returned.
 */

export const dynamic = "force-dynamic";

/** Query-param name → stored dimension + sync function. */
const DIMENSIONS = {
  publisher_platform: {
    dimension: BreakdownDimension.PUBLISHER_PLATFORM,
    run: syncPublisherPlatformBreakdown,
  },
  placement: {
    dimension: BreakdownDimension.PLACEMENT,
    run: syncPlacementBreakdown,
  },
} as const;

type DimensionParam = keyof typeof DIMENSIONS;

const DEFAULT_DIMENSION: DimensionParam = "publisher_platform";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Cron endpoint is not configured." },
      { status: 401 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  const connectionId = req.nextUrl.searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "connectionId is required. This endpoint runs one connection at a time.",
      },
      { status: 400 },
    );
  }

  const dimensionParam =
    req.nextUrl.searchParams.get("dimension") ?? DEFAULT_DIMENSION;
  if (!(dimensionParam in DIMENSIONS)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown dimension "${dimensionParam}". Valid values: ${Object.keys(
          DIMENSIONS,
        ).join(", ")}.`,
      },
      { status: 400 },
    );
  }
  const selected = DIMENSIONS[dimensionParam as DimensionParam];

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";
  const enabled = process.env.BREAKDOWN_SYNC_ENABLED === "true";

  // ---- Dry run: report the plan — zero Meta calls, zero writes ------------
  if (dryRun) {
    const conn = await db.adAccountConnection.findUnique({
      where: { id: connectionId },
      select: { id: true, accountName: true, status: true },
    });
    if (!conn) {
      return NextResponse.json(
        { ok: false, error: "Connection not found." },
        { status: 404 },
      );
    }

    const existingRows = await db.insightsBreakdownDaily.count({
      where: {
        entityType: InsightEntity.ACCOUNT,
        entityId: conn.id,
        dimension: selected.dimension,
      },
    });

    return NextResponse.json({
      ok: true,
      dryRun: true,
      plan: {
        connectionId: conn.id,
        accountName: conn.accountName,
        status: conn.status,
        dimension: selected.dimension,
        entityLevel: InsightEntity.ACCOUNT,
        windowDays: 30,
        breakdownSyncEnabled: enabled,
        existingBreakdownRows: existingRows,
      },
    });
  }

  // ---- Kill switch --------------------------------------------------------
  if (!enabled) {
    return NextResponse.json({
      ok: true,
      outcome: "disabled",
      message:
        "Breakdown sync is disabled. Set BREAKDOWN_SYNC_ENABLED=true to enable it.",
    });
  }

  const result = await selected.run(connectionId);
  console.log(
    `[sync-breakdowns] account=${result.accountName} dimension=${selected.dimension} fetched=${result.fetched} written=${result.written}`,
  );

  return NextResponse.json({ ok: result.outcome !== "failed", result });
}

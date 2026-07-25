import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BreakdownDimension, InsightEntity } from "@prisma/client";
import { db } from "@/lib/db";
import { syncPublisherPlatformBreakdown } from "@/lib/meta/sync-breakdowns";

/**
 * Manual publisher_platform breakdown sync (Phase B — single-account pilot).
 *
 * Fetches ACCOUNT-level `publisher_platform` breakdown insights for ONE
 * connection over a 30-day window and writes them to `InsightsBreakdownDaily`.
 * The entity-level insights pipeline (`InsightsDaily` / `persistInsight`) is
 * never touched.
 *
 * Modes:
 *   - ?connectionId=<id> → REQUIRED. This phase never iterates all connections.
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
        dimension: BreakdownDimension.PUBLISHER_PLATFORM,
      },
    });

    return NextResponse.json({
      ok: true,
      dryRun: true,
      plan: {
        connectionId: conn.id,
        accountName: conn.accountName,
        status: conn.status,
        dimension: BreakdownDimension.PUBLISHER_PLATFORM,
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

  const result = await syncPublisherPlatformBreakdown(connectionId);
  console.log(
    `[sync-breakdowns] account=${result.accountName} fetched=${result.fetched} written=${result.written}`,
  );

  return NextResponse.json({ ok: result.outcome !== "failed", result });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ConnectionStatus } from "@prisma/client";
import {
  syncStructural,
  syncInsightsIncremental,
  syncInsightsBackfill,
} from "@/lib/meta/sync";
import { processFundAlertsForConnection } from "@/server/fund-alerts";

/**
 * Scheduled full sync for every active ad-account connection.
 *
 * Runs structural + insights sync sequentially (one connection at a time) so
 * concurrent Meta Graph calls never stack up and trip rate limit code 17. This
 * sequential traversal is also the real serialization guarantee behind the B1
 * overlap guard in `runJob` (the per-connection check-then-create race only
 * matters under parallelism, which this route never introduces).
 *
 * Mode mirrors the manual server action (`src/server/sync.ts`): a connection
 * whose backfill never succeeded (`insightsBackfilledAt === null`) keeps
 * attempting the 30-day backfill; otherwise it does an incremental pull. After
 * a successful insights sync we replicate the action's post-sync
 * `processFundAlertsForConnection` call (the action itself cannot be reused
 * here because it requires a Clerk session via `requireUser()`).
 *
 * Auth: protected by a static Bearer token (`CRON_SECRET`), mirroring
 * `purge-meta-oauth-sessions/route.ts`. Fails closed: if `CRON_SECRET` is
 * unset or the header does not match, the route does nothing. This route is
 * also listed in the public matcher in `middleware.ts` so the external
 * scheduler can reach it without a Clerk session.
 *
 * Secrets safety: tokens (`accessTokenEnc`) and `CRON_SECRET` are never logged
 * or returned in the response.
 */

export const dynamic = "force-dynamic";

/** Token-expiry warning window: warn when a token dies within 7 days (or is
 * already past), reusing the 7-day idea from digest.ts. Non-fatal. */
const TOKEN_EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000;

type ConnectionOutcome = "synced" | "skipped" | "failed";

interface ConnectionResult {
  connectionId: string;
  status: ConnectionOutcome;
  error?: string;
}

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

  const connections = await db.adAccountConnection.findMany({
    where: {
      status: ConnectionStatus.ACTIVE,
      accessTokenEnc: { not: null },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      insightsBackfilledAt: true,
      tokenExpiresAt: true,
    },
  });

  const results: ConnectionResult[] = [];

  // Sequential traversal — NEVER Promise.all. One await per connection so that
  // syncs never overlap and one connection's failure cannot abort the loop.
  for (const conn of connections) {
    const connectionId = conn.id;
    const mode = conn.insightsBackfilledAt === null ? "initial" : "incremental";
    console.log(`[sync-all] start connectionId=${connectionId} mode=${mode}`);

    try {
      // (a) Token-expiry check — non-fatal. Warn when expiring soon / already
      // expired but STILL attempt the sync; an expired token fails naturally
      // below and is caught as "failed".
      if (
        conn.tokenExpiresAt !== null &&
        conn.tokenExpiresAt.getTime() < Date.now() + TOKEN_EXPIRY_WARN_MS
      ) {
        console.warn(
          `[sync-all] token expiring soon (non-fatal) connectionId=${connectionId} expiresAt=${conn.tokenExpiresAt.toISOString()}`,
        );
      }

      // (b) Structural sync.
      await syncStructural(connectionId);

      // (c) Insights sync — backfill until it has ever succeeded, else
      // incremental. Mirrors the manual server action's mode decision.
      if (mode === "initial") {
        await syncInsightsBackfill(connectionId, 30);
      } else {
        await syncInsightsIncremental(connectionId);
      }

      // (d) Post-sync fund alerts (Meta-reported spend). Own try/catch so an
      // alert error is logged but never changes this connection's outcome,
      // mirroring the server action's guard.
      try {
        await processFundAlertsForConnection(connectionId);
      } catch (err) {
        console.error(
          `[sync-all] fund-alerts processing failed (Meta-reported); sync outcome unaffected connectionId=${connectionId} error=${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // (e) Outcome. The B1 overlap guard makes runJob return SYNC_SKIPPED on a
      // no-op, but the syncStructural/syncInsights* wrappers resolve to void,
      // so the sentinel is not observable here without modifying sync.ts.
      // We therefore count a connection as "synced" unless it threw.
      // TODO: finer skip-attribution ("skipped") requires a later change to
      // surface SYNC_SKIPPED through the void-returning wrappers; do NOT modify
      // sync.ts for that in this step.
      results.push({ connectionId, status: "synced" });
      console.log(
        `[sync-all] outcome connectionId=${connectionId} status=synced`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ connectionId, status: "failed", error: message });
      console.error(
        `[sync-all] outcome connectionId=${connectionId} status=failed error=${message}`,
      );
    }
  }

  const synced = results.filter((r) => r.status === "synced").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log(
    `[sync-all] done total=${results.length} synced=${synced} skipped=${skipped} failed=${failed}`,
  );

  return NextResponse.json({
    ok: true,
    total: results.length,
    synced,
    skipped,
    failed,
    results,
  });
}

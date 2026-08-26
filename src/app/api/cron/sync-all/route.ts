import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AdPlatform, ConnectionStatus } from "@prisma/client";
import {
  syncStructural,
  syncInsightsIncremental,
  syncInsightsBackfill,
} from "@/lib/meta/sync";
import {
  syncPlacementBreakdown,
  syncPublisherPlatformBreakdown,
} from "@/lib/meta/sync-breakdowns";
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

  // Run mode (B3.1): "full" runs structural + insights + fund alerts; "insights"
  // skips structural and runs only insights + fund alerts (structural is
  // daily-enough and wasteful at the 3-hourly cadence). Anything absent or
  // unrecognized falls back to "full" for backward compatibility.
  const requestedMode = req.nextUrl.searchParams.get("mode");
  const runMode: "full" | "insights" =
    requestedMode === "insights" ? "insights" : "full";

  const connections = await db.adAccountConnection.findMany({
    where: {
      // Meta-only pipeline: never enumerate a non-Meta connection.
      platform: AdPlatform.META,
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
    console.log(
      `[sync-all] start connectionId=${connectionId} runMode=${runMode} insightsMode=${mode}`,
    );

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

      // (b) Structural sync — skipped in "insights" run mode.
      if (runMode === "full") {
        await syncStructural(connectionId);
      }

      // (c) Insights sync — backfill until it has ever succeeded, else
      // incremental. Mirrors the manual server action's mode decision.
      if (mode === "initial") {
        await syncInsightsBackfill(connectionId, 30);
      } else {
        await syncInsightsIncremental(connectionId);
      }

      // (c2) Breakdown syncs (publisher_platform, then placement) — "full" run
      // mode only. A trailing 30-day split does not change meaningfully at the
      // 3-hourly "insights" cadence, matching the reasoning that already
      // excludes structural sync there.
      //
      // The kill switch is NOT re-checked here: both sync functions read
      // BREAKDOWN_SYNC_ENABLED themselves and return outcome "disabled" before
      // any Meta call or DB read. Duplicating that check would let them drift
      // apart, so we call unconditionally and branch on the outcome for
      // logging only.
      //
      // Default 30-day window (no `days` argument): the write is an upsert on
      // the compound key, so a daily re-fetch is idempotent and self-healing —
      // any day missed by an earlier run is repaired automatically.
      //
      // Each dimension gets its OWN try/catch, mirroring the fund-alerts guard
      // below: a breakdown error is logged and swallowed. It never reaches the
      // outer catch, never changes this connection's outcome or the
      // synced/skipped/failed counts, never affects the response or the
      // heartbeat, and a failure in one dimension never affects the other.
      // The two calls run sequentially — never in parallel.
      if (runMode === "full") {
        try {
          const breakdown = await syncPublisherPlatformBreakdown(connectionId);
          if (breakdown.outcome === "synced") {
            const rec = breakdown.reconciliation;
            const coverage = rec
              ? ` coverageComplete=${rec.coverageComplete} overlapDeltaPct=${rec.overlapDeltaPct === null ? "n/a" : rec.overlapDeltaPct.toFixed(2)} warning=${rec.warning === null ? "none" : "present"}`
              : " reconciliation=unavailable";
            console.log(
              `[sync-all] breakdown[publisher_platform] synced connectionId=${connectionId} fetched=${breakdown.fetched} written=${breakdown.written}${coverage}`,
            );
          } else if (breakdown.outcome === "disabled") {
            console.log(
              `[sync-all] breakdown[publisher_platform] skipped (disabled) connectionId=${connectionId}`,
            );
          } else {
            console.error(
              `[sync-all] breakdown[publisher_platform] failed (non-fatal); sync outcome unaffected connectionId=${connectionId} error=${breakdown.error ?? "unknown"}`,
            );
          }
        } catch (err) {
          console.error(
            `[sync-all] breakdown[publisher_platform] threw (non-fatal); sync outcome unaffected connectionId=${connectionId} error=${err instanceof Error ? err.message : String(err)}`,
          );
        }

        try {
          const placement = await syncPlacementBreakdown(connectionId);
          if (placement.outcome === "synced") {
            const rec = placement.reconciliation;
            const coverage = rec
              ? ` coverageComplete=${rec.coverageComplete} overlapDeltaPct=${rec.overlapDeltaPct === null ? "n/a" : rec.overlapDeltaPct.toFixed(2)} warning=${rec.warning === null ? "none" : "present"}`
              : " reconciliation=unavailable";
            console.log(
              `[sync-all] breakdown[placement] synced connectionId=${connectionId} fetched=${placement.fetched} written=${placement.written}${coverage}`,
            );
          } else if (placement.outcome === "disabled") {
            console.log(
              `[sync-all] breakdown[placement] skipped (disabled) connectionId=${connectionId}`,
            );
          } else {
            console.error(
              `[sync-all] breakdown[placement] failed (non-fatal); sync outcome unaffected connectionId=${connectionId} error=${placement.error ?? "unknown"}`,
            );
          }
        } catch (err) {
          console.error(
            `[sync-all] breakdown[placement] threw (non-fatal); sync outcome unaffected connectionId=${connectionId} error=${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
    `[sync-all] mode=${runMode} done total=${results.length} synced=${synced} skipped=${skipped} failed=${failed}`,
  );

  // --- External dead-man's-switch heartbeat --------------------------------
  // No in-app check can detect its own scheduler failing to fire (Coolify
  // silently stopped running this route for 15 days in July 2026, causing a
  // 13-day insights gap). So after every completed run we ping an external
  // monitor (healthchecks.io). The monitor alerts when pings *stop* — that
  // absence is the signal, and detection therefore lives outside our
  // infrastructure. Entirely optional and strictly non-fatal: an unset URL is
  // skipped, and any ping error is swallowed so it can never change the HTTP
  // response, the results array, or any connection's sync outcome.
  //
  // The ping URL is a capability URL (anyone holding it can forge a heartbeat)
  // and is therefore treated as a secret — it is never logged.
  const heartbeatUrl =
    runMode === "insights"
      ? process.env.HEARTBEAT_PING_URL_INSIGHTS
      : process.env.HEARTBEAT_PING_URL_FULL;

  if (!heartbeatUrl) {
    console.log(
      `[sync-all] heartbeat ping skipped (not configured) mode=${runMode}`,
    );
  } else {
    try {
      await fetch(heartbeatUrl, { signal: AbortSignal.timeout(5000) });
      console.log(`[sync-all] heartbeat ping sent mode=${runMode}`);
    } catch (err) {
      console.error(
        `[sync-all] heartbeat ping failed (non-fatal) mode=${runMode} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    mode: runMode,
    total: results.length,
    synced,
    skipped,
    failed,
    results,
  });
}

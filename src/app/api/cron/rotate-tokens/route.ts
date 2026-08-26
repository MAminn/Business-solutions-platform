import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { AdPlatform, ConnectionStatus } from "@prisma/client";
import {
  rotateConnectionToken,
  runwayDays,
  type RotateTokenResult,
} from "@/lib/meta/rotate-token";

/**
 * Scheduled Meta token rotation (rotation commit R1).
 *
 * Meta long-lived tokens expire at 60 days. While still valid they can be
 * exchanged for a fresh 60-day token with no user re-authorization
 * (fb_exchange_token). This route drives that rotation — manually via curl
 * now, Coolify-cron later.
 *
 * Modes:
 *   - default            → rotate every ACTIVE connection whose tokenExpiresAt
 *                          is non-null and whose runway is below the threshold;
 *                          others are reported as skipped_not_due.
 *   - ?connectionId=<id> → rotate that one connection regardless of runway.
 *   - ?dryRun=true       → report what WOULD rotate; zero writes, zero Meta calls.
 *
 * Rotation safety lives in rotateConnectionToken: the new token is validated
 * against Meta before the single DB write; on any failure the existing token
 * is untouched and the connection stays ACTIVE.
 *
 * Auth: protected by a static bearer secret (`CRON_SECRET`), mirroring
 * `sync-all/route.ts`. Fails closed when `CRON_SECRET` is unset.
 *
 * Secrets safety: token bytes and `CRON_SECRET` are never logged or returned.
 * Logs carry account name + outcome only.
 */

export const dynamic = "force-dynamic";

/** Rotate when fewer than this many whole days of token runway remain. */
const ROTATION_RUNWAY_THRESHOLD_DAYS = 21;

interface SkippedResult {
  connectionId: string;
  accountName: string;
  outcome: "skipped_not_due";
  runwayDays: number | null;
}

interface DryRunResult {
  connectionId: string;
  accountName: string;
  runwayDays: number | null;
  wouldRotate: boolean;
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

  const connectionIdParam = req.nextUrl.searchParams.get("connectionId");
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "true";

  // ---- Dry run: evaluate only — zero writes, zero Meta calls --------------
  if (dryRun) {
    const connections = await db.adAccountConnection.findMany({
      // An explicit id stays unfiltered so an operator can inspect any
      // connection; the default sweep is Meta-only.
      where: connectionIdParam
        ? { id: connectionIdParam }
        : { platform: AdPlatform.META, status: ConnectionStatus.ACTIVE },
      orderBy: { id: "asc" },
      select: {
        id: true,
        accountName: true,
        status: true,
        platform: true,
        accessTokenEnc: true,
        tokenExpiresAt: true,
      },
    });

    const results: DryRunResult[] = connections.map((conn) => {
      const runway = runwayDays(conn.tokenExpiresAt);
      // A dry run must not claim it would rotate a connection that provably
      // cannot rotate, so platform is a conjunct in both branches.
      const wouldRotate = connectionIdParam
        ? conn.platform === AdPlatform.META &&
          conn.status === ConnectionStatus.ACTIVE &&
          conn.accessTokenEnc !== null
        : conn.platform === AdPlatform.META &&
          conn.accessTokenEnc !== null &&
          runway !== null &&
          runway < ROTATION_RUNWAY_THRESHOLD_DAYS;
      console.log(
        `[rotate-tokens] dryRun account=${conn.accountName} wouldRotate=${wouldRotate}`,
      );
      return {
        connectionId: conn.id,
        accountName: conn.accountName,
        runwayDays: runway,
        wouldRotate,
      };
    });

    return NextResponse.json({ ok: true, dryRun: true, results });
  }

  // ---- Manual mode: rotate one connection regardless of runway ------------
  if (connectionIdParam) {
    const result = await rotateConnectionToken(connectionIdParam);
    console.log(
      `[rotate-tokens] account=${result.accountName} outcome=${result.outcome}`,
    );
    return NextResponse.json({ ok: true, results: [result] });
  }

  // ---- Default: rotate every ACTIVE connection due for rotation -----------
  const connections = await db.adAccountConnection.findMany({
    // Meta-only rotation: never enumerate a non-Meta connection.
    where: { platform: AdPlatform.META, status: ConnectionStatus.ACTIVE },
    orderBy: { id: "asc" },
    select: { id: true, accountName: true, tokenExpiresAt: true },
  });

  const results: Array<RotateTokenResult | SkippedResult> = [];

  // Sequential traversal — one connection at a time, mirroring sync-all.
  for (const conn of connections) {
    const runway = runwayDays(conn.tokenExpiresAt);
    const due = runway !== null && runway < ROTATION_RUNWAY_THRESHOLD_DAYS;

    if (!due) {
      results.push({
        connectionId: conn.id,
        accountName: conn.accountName,
        outcome: "skipped_not_due",
        runwayDays: runway,
      });
      console.log(
        `[rotate-tokens] account=${conn.accountName} outcome=skipped_not_due`,
      );
      continue;
    }

    const result = await rotateConnectionToken(conn.id);
    results.push(result);
    console.log(
      `[rotate-tokens] account=${result.accountName} outcome=${result.outcome}`,
    );
  }

  return NextResponse.json({ ok: true, results });
}

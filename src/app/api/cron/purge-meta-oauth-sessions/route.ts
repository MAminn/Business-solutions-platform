import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { purgeExpiredPendingSessions } from "@/lib/meta/pending-session";

/**
 * Scheduled cleanup for abandoned pending Meta OAuth sessions.
 *
 * Deletes every `PendingMetaOAuthSession` row whose `expiresAt` is in the past.
 * Expired rows are already treated as absent by `loadPendingSession`; this job
 * just reclaims storage for sessions the user never completed or cancelled.
 *
 * Auth: protected by a static Bearer token (`CRON_SECRET`) so only the
 * scheduler can invoke it. If `CRON_SECRET` is not set the endpoint is disabled
 * (503) rather than left open. This route is also listed in the public matcher
 * in `middleware.ts` so the external scheduler can reach it without a Clerk
 * session.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Cron endpoint is not configured." },
      { status: 503 },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  const purged = await purgeExpiredPendingSessions();
  return NextResponse.json({ ok: true, purged });
}

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { decryptToken } from "@/lib/encryption";
import { verifyTikTokState } from "@/lib/tiktok/oauth";
import { TikTokClient, TikTokApiError } from "@/lib/tiktok/client";
import { isTikTokConnectEnabled } from "@/lib/tiktok/flags";
import {
  TIKTOK_NONCE_COOKIE,
  TIKTOK_PENDING_COOKIE,
  clearTikTokNonceCookie,
  tiktokPendingCookieOptions,
} from "@/lib/tiktok/oauth-cookies";
import {
  createPendingTikTokSession,
  type PendingTikTokAdvertiser,
} from "@/server/tiktok-oauth-session";
import { writeAudit } from "@/server/audit";
import { getPublicBaseUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Scope ids the workspace TikTok apps are configured with in the portal.
// A mismatch is logged, never enforced: TikTok grants permissions wholesale.
const EXPECTED_SCOPES = [10, 44, 200, 210, 220, 610];

async function getOrgIdForUser(userId: string): Promise<string | null> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return member?.organizationId ?? null;
}

// Equal-length Buffers only; a length mismatch is a failure, not a throw.
function nonceMatches(cookieNonce: string, stateNonce: string): boolean {
  const a = Buffer.from(cookieNonce, "utf8");
  const b = Buffer.from(stateNonce, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function scopesMatchExpected(scopes: number[] | null): boolean {
  if (!scopes) return false;
  const sorted = [...scopes].sort((x, y) => x - y);
  return (
    sorted.length === EXPECTED_SCOPES.length &&
    sorted.every((s, i) => s === EXPECTED_SCOPES[i])
  );
}

/**
 * TikTok redirects here with `auth_code` and `state`. The nonce cookie is
 * single-use: every response built below goes through `exit`, which expires
 * it, so no path — success, rejection or unexpected throw — can leave it set.
 *
 * Never logs or redirects with the token, app secret or auth code.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cookieNonce = req.cookies.get(TIKTOK_NONCE_COOKIE)?.value;

  const exit = (path: string): NextResponse => {
    const res = NextResponse.redirect(new URL(path, getPublicBaseUrl(req)));
    clearTikTokNonceCookie(res);
    return res;
  };
  const fail = (code: string) => exit(`/settings/integrations?error=${code}`);

  try {
    return await handleCallback(req, cookieNonce, exit, fail);
  } catch {
    return fail("unknown");
  }
}

async function handleCallback(
  req: NextRequest,
  cookieNonce: string | undefined,
  exit: (path: string) => NextResponse,
  fail: (code: string) => NextResponse,
): Promise<NextResponse> {
  if (!isTikTokConnectEnabled()) return fail("tiktok_disabled");

  const url = new URL(req.url);
  const authCode = url.searchParams.get("auth_code");
  const stateRaw = url.searchParams.get("state");
  if (!authCode || !stateRaw) {
    // Parameter NAMES only — values may carry the auth code.
    console.warn("[tiktok-oauth] callback missing auth_code or state", {
      params: Array.from(new Set(url.searchParams.keys())),
    });
    return fail("tiktok_missing_code");
  }

  const state = verifyTikTokState(stateRaw);
  if (!state) return fail("tiktok_state");
  if (!cookieNonce || !nonceMatches(cookieNonce, state.nonce)) {
    return fail("tiktok_state");
  }

  let user;
  try {
    user = await requireUser();
  } catch {
    return exit("/sign-in?redirect=/settings/integrations");
  }
  if (state.userId !== user.id) return fail("tiktok_state");

  const organizationId = await getOrgIdForUser(user.id);
  if (!organizationId) return fail("tiktok_profile");
  if (organizationId !== state.organizationId) return fail("tiktok_state");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(state.clientId)) return fail("tiktok_state");

  const profile = await db.tikTokAppProfile.findFirst({
    where: { id: state.tiktokAppProfileId, organizationId },
    select: { id: true, appId: true, appSecretEnc: true },
  });
  if (!profile) return fail("tiktok_state");

  let appSecret: string;
  try {
    appSecret = decryptToken(profile.appSecretEnc);
  } catch {
    return fail("tiktok_exchange");
  }

  const tiktok = new TikTokClient();

  let exchange: Awaited<ReturnType<TikTokClient["exchangeCodeForToken"]>>;
  try {
    exchange = await tiktok.exchangeCodeForToken(authCode, {
      appId: profile.appId,
      appSecret,
    });
  } catch (err) {
    logTikTokFailure("token exchange", err);
    return fail("tiktok_exchange");
  }

  let advertisers: PendingTikTokAdvertiser[];
  try {
    const authorized = await tiktok.listAuthorizedAdvertisers(
      exchange.accessToken,
      profile.appId,
      appSecret,
    );
    const ids = Array.from(
      new Set(authorized.map((a) => a.advertiserId).filter(Boolean)),
    );
    if (ids.length === 0) {
      return exit("/settings/integrations?warning=tiktok_no_advertisers");
    }

    const info = await tiktok.getAdvertiserInfo(exchange.accessToken, ids);
    const infoById = new Map(info.map((i) => [i.advertiserId, i]));

    // Explicit four-field projection: TikTok's `status` is discarded here.
    // Timezone is kept verbatim ("Etc/GMT-2" means UTC+2).
    advertisers = [];
    for (const id of ids) {
      const i = infoById.get(id);
      if (!i) {
        // Refuse an incomplete snapshot rather than invent currency/timezone.
        console.warn("[tiktok-oauth] advertiser/info omitted advertisers", {
          requested: ids.length,
          returned: infoById.size,
        });
        return fail("tiktok_exchange");
      }
      advertisers.push({
        id,
        name: i.name,
        currency: i.currency,
        timezone: i.timezone,
      });
    }
  } catch (err) {
    logTikTokFailure("advertiser lookup", err);
    return fail("tiktok_exchange");
  }

  // Only when TikTok actually returned an expiry. Never fabricated.
  const tokenExpiresAt =
    exchange.expiresInSec !== null
      ? new Date(Date.now() + exchange.expiresInSec * 1000)
      : null;

  const sessionId = await createPendingTikTokSession({
    userId: user.id,
    organizationId,
    clientId: state.clientId,
    tiktokAppProfileId: profile.id,
    accessToken: exchange.accessToken,
    tokenExpiresAt,
    advertisers,
    scopes: exchange.scopes,
  });

  const scopesMatch = scopesMatchExpected(exchange.scopes);
  if (!scopesMatch) {
    console.warn("[tiktok-oauth] granted scopes differ from expected", {
      expected: EXPECTED_SCOPES,
      granted: exchange.scopes,
    });
  }

  await writeAudit({
    userId: user.id,
    organizationId,
    action: "tiktok_oauth.callback",
    entityType: "TikTokAppProfile",
    entityId: profile.id,
    metadata: {
      tiktokAppProfileId: profile.id,
      clientId: state.clientId,
      advertiserCount: advertisers.length,
      scopes: exchange.scopes,
      scopesMatchExpected: scopesMatch,
    },
  });

  const res = exit("/settings/integrations/tiktok-select");
  res.cookies.set(TIKTOK_PENDING_COOKIE, sessionId, tiktokPendingCookieOptions());
  return res;
}

// TikTokApiError messages are already redacted; log only code + request_id.
function logTikTokFailure(step: string, err: unknown): void {
  if (err instanceof TikTokApiError) {
    console.warn(`[tiktok-oauth] ${step} failed`, {
      code: err.code,
      requestId: err.requestId,
    });
  } else {
    console.warn(`[tiktok-oauth] ${step} failed (non-TikTok error)`);
  }
}

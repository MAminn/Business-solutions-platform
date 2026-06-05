import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { decryptToken } from "@/lib/encryption";
import {
  verifyState,
  exchangeCodeForTokenWithProfile,
  exchangeForLongLivedTokenWithProfile,
  type MetaAppCredentials,
} from "@/lib/meta/oauth";
import { MetaClient } from "@/lib/meta/client";
import { getPublicBaseUrl } from "@/lib/utils";
import {
  META_PENDING_COOKIE,
  PENDING_COOKIE_MAX_AGE_SEC,
  serializePendingSession,
  type PendingAdAccount,
} from "@/lib/meta/pending-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getOrgIdForUser(userId: string): Promise<string | null> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return member?.organizationId ?? null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=meta_exchange",
        getPublicBaseUrl(req),
      ),
    );
  }
  if (!code || !stateRaw) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=invalid_state",
        getPublicBaseUrl(req),
      ),
    );
  }

  // CSRF protection: verify the signed state round-trip.
  const state = verifyState(stateRaw);
  if (!state || !state.metaAppProfileId) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=invalid_state",
        getPublicBaseUrl(req),
      ),
    );
  }

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.redirect(
      new URL(
        "/sign-in?redirect=/settings/integrations",
        getPublicBaseUrl(req),
      ),
    );
  }

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(state.clientId)) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=forbidden", getPublicBaseUrl(req)),
    );
  }

  // Resolve the workspace-owned app profile, strictly scoped to the org, and
  // decrypt its secret. New connections never use env credentials.
  const organizationId = await getOrgIdForUser(user.id);
  if (!organizationId) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=unknown", getPublicBaseUrl(req)),
    );
  }

  const profile = await db.metaAppProfile.findFirst({
    where: { id: state.metaAppProfileId, organizationId },
    select: { id: true, appId: true, appSecretEnc: true, apiVersion: true },
  });
  if (!profile) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=profile_required",
        getPublicBaseUrl(req),
      ),
    );
  }

  let creds: MetaAppCredentials;
  try {
    creds = {
      appId: profile.appId,
      appSecret: decryptToken(profile.appSecretEnc),
      apiVersion: profile.apiVersion,
    };
  } catch {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=meta_exchange",
        getPublicBaseUrl(req),
      ),
    );
  }

  let shortLivedToken: string;
  try {
    const r = await exchangeCodeForTokenWithProfile(code, creds);
    shortLivedToken = r.access_token;
  } catch {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=meta_exchange",
        getPublicBaseUrl(req),
      ),
    );
  }

  let longLivedToken: string;
  let expiresInSec: number | undefined;
  try {
    const r = await exchangeForLongLivedTokenWithProfile(
      shortLivedToken,
      creds,
    );
    longLivedToken = r.access_token;
    expiresInSec = r.expires_in;
  } catch {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=meta_exchange",
        getPublicBaseUrl(req),
      ),
    );
  }

  const meta = new MetaClient(longLivedToken, creds.apiVersion);
  let granted: Awaited<ReturnType<typeof meta.listAdAccounts>>;
  try {
    granted = await meta.listAdAccounts();
  } catch {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?error=meta_exchange",
        getPublicBaseUrl(req),
      ),
    );
  }

  if (granted.length === 0) {
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?warning=no_accounts",
        getPublicBaseUrl(req),
      ),
    );
  }

  const accounts: PendingAdAccount[] = Array.from(
    new Map(
      granted.map((g) => [
        g.id,
        {
          id: g.id,
          name: g.name,
          currency: g.currency,
          timezone: g.timezone_name,
        } satisfies PendingAdAccount,
      ]),
    ).values(),
  );

  const expiresAt = expiresInSec
    ? new Date(Date.now() + expiresInSec * 1000)
    : new Date(Date.now() + 60 * 24 * 3600 * 1000);

  // Do NOT auto-create connections. Hold the (encrypted) token + account list
  // in a short-lived signed cookie and redirect to the selection screen.
  const cookieValue = serializePendingSession({
    clientId: state.clientId,
    metaAppProfileId: profile.id,
    accessToken: longLivedToken,
    tokenExpiresAt: expiresAt,
    accounts,
  });

  const res = NextResponse.redirect(
    new URL("/settings/integrations/select", getPublicBaseUrl(req)),
  );
  res.cookies.set(META_PENDING_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_COOKIE_MAX_AGE_SEC,
  });
  return res;
}

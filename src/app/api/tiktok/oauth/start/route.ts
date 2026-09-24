import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildTikTokAuthorizeUrl, signTikTokState } from "@/lib/tiktok/oauth";
import { isTikTokConnectEnabled } from "@/lib/tiktok/flags";
import {
  TIKTOK_NONCE_COOKIE,
  tiktokNonceCookieOptions,
} from "@/lib/tiktok/oauth-cookies";
import { getPublicBaseUrl } from "@/lib/utils";

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
  const fail = (code: string) =>
    NextResponse.redirect(
      new URL(`/settings/integrations?error=${code}`, getPublicBaseUrl(req)),
    );

  if (!isTikTokConnectEnabled()) return fail("tiktok_disabled");

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

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const tiktokAppProfileId = url.searchParams.get("tiktokAppProfileId");

  if (!clientId) return fail("tiktok_client");
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(clientId)) return fail("tiktok_client");

  if (!tiktokAppProfileId) return fail("tiktok_profile");
  const organizationId = await getOrgIdForUser(user.id);
  if (!organizationId) return fail("tiktok_profile");

  // Only the public appId is needed here; the secret stays in the DB until
  // the callback's token exchange.
  const profile = await db.tikTokAppProfile.findFirst({
    where: { id: tiktokAppProfileId, organizationId },
    select: { id: true, appId: true },
  });
  if (!profile) return fail("tiktok_profile");

  const nonce = crypto.randomBytes(32).toString("hex");
  const state = signTikTokState({
    userId: user.id,
    organizationId,
    clientId,
    tiktokAppProfileId: profile.id,
    nonce,
    issuedAt: Date.now(),
  });

  const res = NextResponse.redirect(
    buildTikTokAuthorizeUrl({ appId: profile.appId, state }),
  );
  res.cookies.set(TIKTOK_NONCE_COOKIE, nonce, tiktokNonceCookieOptions());
  return res;
}

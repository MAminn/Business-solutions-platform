import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ConnectionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import { encryptToken } from "@/lib/encryption";
import {
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
} from "@/lib/meta/oauth";
import { MetaClient } from "@/lib/meta/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=meta_exchange", req.url),
    );
  }
  if (!code || !stateRaw) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", req.url),
    );
  }

  const state = verifyState(stateRaw);
  if (!state) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=invalid_state", req.url),
    );
  }

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.redirect(
      new URL("/sign-in?redirect=/settings/integrations", req.url),
    );
  }

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(state.clientId)) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=forbidden", req.url),
    );
  }

  let shortLivedToken: string;
  try {
    const r = await exchangeCodeForToken(code);
    shortLivedToken = r.access_token;
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=meta_exchange", req.url),
    );
  }

  let longLivedToken: string;
  let expiresInSec: number | undefined;
  try {
    const r = await exchangeForLongLivedToken(shortLivedToken);
    longLivedToken = r.access_token;
    expiresInSec = r.expires_in;
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=meta_exchange", req.url),
    );
  }

  const meta = new MetaClient(longLivedToken);
  let granted: Awaited<ReturnType<typeof meta.listAdAccounts>>;
  try {
    granted = await meta.listAdAccounts();
  } catch {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=meta_exchange", req.url),
    );
  }

  const grantedIds = Array.from(new Set(granted.map((g) => g.id)));
  const existing = await db.adAccountConnection.findMany({
    where: {
      clientId: state.clientId,
      platform: "META",
      platformAccountId: { in: grantedIds },
    },
    select: {
      id: true,
      platformAccountId: true,
      accountName: true,
      clientId: true,
    },
  });

  if (existing.length === 0) {
    return NextResponse.redirect(
      new URL("/settings/integrations?warning=no_match", req.url),
    );
  }

  const tokenEnc = encryptToken(longLivedToken);
  const expiresAt = expiresInSec
    ? new Date(Date.now() + expiresInSec * 1000)
    : new Date(Date.now() + 60 * 24 * 3600 * 1000);

  const orgId = await getOrgIdForUser(user.id);

  for (const conn of existing) {
    const grant = granted.find((g) => g.id === conn.platformAccountId);
    await db.adAccountConnection.update({
      where: { id: conn.id },
      data: {
        accessTokenEnc: tokenEnc,
        tokenExpiresAt: expiresAt,
        status: ConnectionStatus.ACTIVE,
        lastSyncError: null,
        currency: grant?.currency ?? undefined,
        timezone: grant?.timezone_name ?? undefined,
      },
    });

    await writeAudit({
      userId: user.id,
      organizationId: orgId,
      action: "connection.token_set",
      entityType: "AdAccountConnection",
      entityId: conn.id,
      metadata: {
        clientId: conn.clientId,
        platformAccountId: conn.platformAccountId,
        accountName: conn.accountName,
        tokenExpiresAt: expiresAt.toISOString(),
      },
    });
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?connected=${existing.length}`, req.url),
  );
}

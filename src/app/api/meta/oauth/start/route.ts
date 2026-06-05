import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { db } from "@/lib/db";
import { signState, buildAuthorizeUrlWithProfile } from "@/lib/meta/oauth";
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
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId");
    const metaAppProfileId = url.searchParams.get("metaAppProfileId");

    if (!clientId) {
      return NextResponse.redirect(
        new URL("/settings/integrations?error=unknown", getPublicBaseUrl(req)),
      );
    }

    // New connections require a workspace-owned Meta App profile.
    if (!metaAppProfileId) {
      return NextResponse.redirect(
        new URL(
          "/settings/integrations?error=profile_required",
          getPublicBaseUrl(req),
        ),
      );
    }

    const accessible = await getAccessibleClientIds(user);
    if (!accessible.includes(clientId)) {
      return NextResponse.redirect(
        new URL(
          "/settings/integrations?error=forbidden",
          getPublicBaseUrl(req),
        ),
      );
    }

    // Resolve + scope the selected profile to the caller's org. We only need
    // the public appId and apiVersion to build the authorize URL — the secret
    // stays server-side and is used later during token exchange.
    const organizationId = await getOrgIdForUser(user.id);
    if (!organizationId) {
      return NextResponse.redirect(
        new URL("/settings/integrations?error=unknown", getPublicBaseUrl(req)),
      );
    }

    const profile = await db.metaAppProfile.findFirst({
      where: { id: metaAppProfileId, organizationId },
      select: { id: true, appId: true, apiVersion: true },
    });
    if (!profile) {
      return NextResponse.redirect(
        new URL(
          "/settings/integrations?error=profile_required",
          getPublicBaseUrl(req),
        ),
      );
    }

    const state = signState({
      clientId,
      metaAppProfileId: profile.id,
      nonce: crypto.randomUUID(),
      issuedAt: Date.now(),
    });

    return NextResponse.redirect(
      buildAuthorizeUrlWithProfile({
        appId: profile.appId,
        apiVersion: profile.apiVersion,
        state,
      }),
    );
  } catch {
    return NextResponse.redirect(
      new URL(
        "/sign-in?redirect=/settings/integrations",
        getPublicBaseUrl(req),
      ),
    );
  }
}

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { signState, buildAuthorizeUrl } from "@/lib/meta/oauth";
import { getPublicBaseUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=not_configured", getPublicBaseUrl(req)),
    );
  }

  try {
    const user = await requireUser();
    const clientId = new URL(req.url).searchParams.get("clientId");
    if (!clientId) {
      return NextResponse.redirect(
        new URL("/settings/integrations?error=unknown", getPublicBaseUrl(req)),
      );
    }

    const accessible = await getAccessibleClientIds(user);
    if (!accessible.includes(clientId)) {
      return NextResponse.redirect(
        new URL("/settings/integrations?error=forbidden", getPublicBaseUrl(req)),
      );
    }

    const state = signState({
      clientId,
      nonce: crypto.randomUUID(),
      issuedAt: Date.now(),
    });
    return NextResponse.redirect(buildAuthorizeUrl(state));
  } catch {
    return NextResponse.redirect(
      new URL("/sign-in?redirect=/settings/integrations", getPublicBaseUrl(req)),
    );
  }
}

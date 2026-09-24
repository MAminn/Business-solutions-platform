/**
 * TikTok for Business OAuth helpers.
 *
 * Phase 1b ships app-profile credentials only; the authorize URL, state and
 * token exchange are added alongside the OAuth routes.
 */

import crypto from "node:crypto";

/**
 * The OAuth redirect URI users must whitelist in their TikTok app. This is the
 * same callback for every workspace app; each org adds it to their own app.
 */
export function getTikTokOAuthRedirectUri(): string {
  return process.env.TIKTOK_OAUTH_REDIRECT_URL ?? "";
}

// TikTok Marketing API "Advertiser authorization URL" base.
// NOT confirmed against a first-party source in this repo — verify it against
// the app's Advertiser authorization URL in the TikTok developer portal before
// the OAuth routes (Phase 1c-2) ship.
export const TIKTOK_AUTHORIZE_URL = "https://business-api.tiktok.com/portal/auth";

export interface TikTokOAuthState {
  userId: string;
  organizationId: string;
  clientId: string;
  tiktokAppProfileId: string;
  nonce: string;
  issuedAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Exactly three params. No `scope`: the Marketing API does not accept one —
 * permissions are fixed on the app in the developer portal and the advertiser
 * grants them all or declines.
 */
export function buildTikTokAuthorizeUrl(args: {
  appId: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    app_id: args.appId,
    state: args.state,
    redirect_uri: getTikTokOAuthRedirectUri(),
  });
  return `${TIKTOK_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Sign + base64-encode state for the OAuth round-trip.
 * Same mechanism as the Meta flow (lib/meta/oauth.ts signState): HMAC-SHA256
 * with TOKEN_ENCRYPTION_KEY as the secret, `payload.sig` in base64url.
 */
export function signTikTokState(state: TikTokOAuthState): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function isTikTokOAuthState(value: unknown): value is TikTokOAuthState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    typeof v.organizationId === "string" &&
    typeof v.clientId === "string" &&
    typeof v.tiktokAppProfileId === "string" &&
    typeof v.nonce === "string" &&
    typeof v.issuedAt === "number" &&
    Number.isFinite(v.issuedAt)
  );
}

/**
 * Returns null on a bad signature, malformed input, or state older than
 * 10 minutes. The shape check also rejects a (validly signed) Meta state,
 * since both flows share the signing secret.
 */
export function verifyTikTokState(signed: string): TikTokOAuthState | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
  const [payload, sig] = signed.split(".");
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (expected !== sig) return null;
  try {
    const state: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!isTikTokOAuthState(state)) return null;
    if (Date.now() - state.issuedAt > STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}

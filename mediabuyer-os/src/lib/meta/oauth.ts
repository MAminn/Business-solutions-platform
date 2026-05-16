/**
 * Meta (Facebook) Marketing API OAuth helpers.
 *
 * v1 supports Meta only. The implementation here covers the OAuth flow
 * skeleton — actual API calls are added in lib/meta/client.ts.
 *
 * Flow:
 *   1. GET /api/meta/oauth/start?clientId=...
 *      → redirect to Facebook with state token (clientId + nonce)
 *   2. User approves on Facebook
 *      → Facebook redirects to /api/meta/oauth/callback?code=...&state=...
 *   3. Exchange code for short-lived token, then exchange for long-lived (60d)
 *   4. List ad accounts, persist tokens encrypted, create AdAccountConnection rows
 */

import crypto from "node:crypto";

export const META_API_VERSION = process.env.META_API_VERSION ?? "v23.0";
export const META_GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;
export const META_OAUTH_URL = `https://www.facebook.com/${META_API_VERSION}/dialog/oauth`;

export const META_SCOPES = [
  "ads_read",
  "business_management",
  "read_insights",
  // Add "ads_management" later when you ship the auto-pause/scale feature
];

export interface OAuthState {
  clientId: string;
  nonce: string;
  issuedAt: number;
}

/**
 * Sign + base64-encode state for the OAuth round-trip.
 * Uses HMAC-SHA256 with TOKEN_ENCRYPTION_KEY as the secret.
 */
export function signState(state: OAuthState): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(signed: string): OAuthState | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
  const [payload, sig] = signed.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected !== sig) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    // 10 minute expiry
    if (Date.now() - state.issuedAt > 10 * 60 * 1000) return null;
    return state;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    redirect_uri: process.env.META_OAUTH_REDIRECT_URL ?? "",
    state,
    scope: META_SCOPES.join(","),
    response_type: "code",
  });
  return `${META_OAUTH_URL}?${params.toString()}`;
}

/**
 * Exchange the short-lived code for a short-lived user access token.
 */
export async function exchangeCodeForToken(code: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in?: number;
}> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    redirect_uri: process.env.META_OAUTH_REDIRECT_URL ?? "",
    code,
  });
  const res = await fetch(`${META_GRAPH_URL}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Exchange a short-lived token for a long-lived one (60-day validity).
 */
export async function exchangeForLongLivedToken(shortToken: string): Promise<{
  access_token: string;
  token_type: string;
  expires_in?: number;
}> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID ?? "",
    client_secret: process.env.META_APP_SECRET ?? "",
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${META_GRAPH_URL}/oauth/access_token?${params.toString()}`);
  if (!res.ok) throw new Error(`Meta long-lived token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

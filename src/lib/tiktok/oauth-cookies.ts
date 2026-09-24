import type { NextResponse } from "next/server";

/**
 * Names and options for both TikTok OAuth cookies. This module is the single
 * owner of them; routes and pages never spell a name or option inline.
 */

// Binds the signed state to the browser that started the flow. Meta has no
// equivalent; this one is deliberate.
export const TIKTOK_NONCE_COOKIE = "tiktok_oauth_nonce";

// Holds only the pending-session row id. TikTok analogue of Meta's
// `meta_oauth_pending`.
export const TIKTOK_PENDING_COOKIE = "tiktok_oauth_pending";

const NONCE_COOKIE_PATH = "/api/tiktok/oauth";

/**
 * sameSite must be "lax": a "strict" cookie is not sent on TikTok's cross-site
 * redirect back to the callback, which would fail every legitimate
 * authorization.
 */
export function tiktokNonceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: NONCE_COOKIE_PATH,
    maxAge: 600,
  };
}

// Mirrors Meta's pending cookie options exactly (15 minutes).
export function tiktokPendingCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 900,
  };
}

/**
 * Expire the nonce cookie on an outgoing response. Uses the same path it was
 * set with, otherwise the browser keeps the original.
 */
export function clearTikTokNonceCookie(res: NextResponse): void {
  res.cookies.set(TIKTOK_NONCE_COOKIE, "", {
    ...tiktokNonceCookieOptions(),
    maxAge: 0,
  });
}

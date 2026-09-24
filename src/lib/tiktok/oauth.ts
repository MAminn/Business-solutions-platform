/**
 * TikTok for Business OAuth helpers.
 *
 * Phase 1b ships app-profile credentials only; the authorize URL, state and
 * token exchange are added alongside the OAuth routes.
 */

/**
 * The OAuth redirect URI users must whitelist in their TikTok app. This is the
 * same callback for every workspace app; each org adds it to their own app.
 */
export function getTikTokOAuthRedirectUri(): string {
  return process.env.TIKTOK_OAUTH_REDIRECT_URL ?? "";
}

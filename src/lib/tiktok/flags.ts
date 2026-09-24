/**
 * Kill switch for the TikTok connect flow (OAuth start/callback, launcher and
 * advertiser page). Disabled unless `TIKTOK_CONNECT_ENABLED === "true"` —
 * parsed exactly like BREAKDOWN_SYNC_ENABLED; any other value is off.
 */
export function isTikTokConnectEnabled(): boolean {
  return process.env.TIKTOK_CONNECT_ENABLED === "true";
}

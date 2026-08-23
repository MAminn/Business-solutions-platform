import { db } from "@/lib/db";
import { AdPlatform, ConnectionStatus } from "@prisma/client";
import { decryptToken, encryptToken } from "@/lib/encryption";
import {
  exchangeForLongLivedToken,
  exchangeForLongLivedTokenWithProfile,
  META_GRAPH_URL,
  type MetaAppCredentials,
} from "@/lib/meta/oauth";

/**
 * Meta long-lived token rotation (rotation commit R1).
 *
 * While a long-lived token is still valid, Meta's `fb_exchange_token` flow
 * returns a fresh 60-day token with no user re-authorization. This module
 * refreshes a connection's token safely.
 *
 * Prime directive: NEVER destroy a working token. The new token is validated
 * against Meta (a lightweight ads_read call on the connection's own account)
 * BEFORE anything is persisted; on any failure the existing token is left
 * byte-for-byte untouched and the connection stays ACTIVE.
 *
 * Secrets safety: token bytes are decrypted in memory only and are never
 * logged, returned, or persisted in plaintext — not in results, not in
 * `lastSyncError`, not in console output.
 */

export interface RotateTokenResult {
  connectionId: string;
  accountName: string;
  outcome: "rotated" | "failed";
  /** Whole days until the pre-rotation expiry; null when tokenExpiresAt is unset. */
  runwayDaysBefore: number | null;
  runwayDaysAfter?: number;
  reason?: string;
}

/** Prefix for rotation failures persisted to `lastSyncError`. Only errors with
 * this prefix are cleared by a later successful rotation. */
const ROTATE_ERROR_PREFIX = "ROTATE:";

/** Fallback token lifetime when Meta omits `expires_in` — same 60-day fallback
 * the OAuth callback uses. */
const FALLBACK_TOKEN_LIFETIME_MS = 60 * 24 * 3600 * 1000;

const MAX_PERSISTED_REASON_LEN = 300;

export function runwayDays(expiresAt: Date | null): number | null {
  if (expiresAt === null) return null;
  return Math.floor((expiresAt.getTime() - Date.now()) / (24 * 3600 * 1000));
}

/**
 * Strip anything that could be token material from an upstream error string,
 * then truncate. Meta error bodies normally never echo tokens, but we redact
 * defensively: any long unbroken secret-looking run is replaced.
 */
function sanitizeReason(raw: string, secrets: string[]): string {
  let out = raw;
  for (const s of secrets) {
    if (s.length > 0) out = out.split(s).join("[redacted]");
  }
  // Redact long unbroken token-like runs (Meta user tokens are 100+ chars).
  out = out.replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > MAX_PERSISTED_REASON_LEN) {
    out = `${out.slice(0, MAX_PERSISTED_REASON_LEN)}…`;
  }
  return out;
}

/** Persist a ROTATE-prefixed failure reason. Token fields and status are
 * deliberately NOT touched — the old token remains valid for its runway. */
async function persistRotateError(
  connectionId: string,
  reason: string,
): Promise<void> {
  await db.adAccountConnection.update({
    where: { id: connectionId },
    data: { lastSyncError: `${ROTATE_ERROR_PREFIX} ${reason}` },
  });
}

/**
 * Rotate one connection's Meta access token via `fb_exchange_token`.
 *
 * Expected failures resolve to `outcome: "failed"` (no throw). The single
 * token write happens only after the new token has been validated against
 * Meta; every failure path leaves `accessTokenEnc` / `tokenExpiresAt`
 * untouched and the connection ACTIVE.
 */
export async function rotateConnectionToken(
  connectionId: string,
): Promise<RotateTokenResult> {
  const conn = await db.adAccountConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      accountName: true,
      status: true,
      accessTokenEnc: true,
      tokenExpiresAt: true,
      lastSyncError: true,
      platform: true,
      platformAccountId: true,
      metaAppProfileId: true,
    },
  });

  // ---- Guards: fail cleanly with no writes -------------------------------
  if (!conn) {
    return {
      connectionId,
      accountName: "(unknown)",
      outcome: "failed",
      runwayDaysBefore: null,
      reason: "Connection not found.",
    };
  }

  const runwayDaysBefore = runwayDays(conn.tokenExpiresAt);
  const base: Pick<
    RotateTokenResult,
    "connectionId" | "accountName" | "runwayDaysBefore"
  > = {
    connectionId: conn.id,
    accountName: conn.accountName,
    runwayDaysBefore,
  };

  // Token rotation is a Meta `fb_exchange_token` flow — never run it against a
  // non-Meta connection. No DB write on this path.
  if (conn.platform !== AdPlatform.META) {
    return {
      ...base,
      outcome: "failed",
      reason: "Connection is not a Meta connection.",
    };
  }

  if (conn.status !== ConnectionStatus.ACTIVE) {
    return {
      ...base,
      outcome: "failed",
      reason: `Connection status is ${conn.status}, not ACTIVE.`,
    };
  }
  if (!conn.accessTokenEnc) {
    return {
      ...base,
      outcome: "failed",
      reason: "Connection has no stored access token.",
    };
  }

  // ---- Resolve exchange credentials, exactly as the OAuth callback does ---
  // Profile connections use the workspace-owned app's credentials; legacy
  // rows (metaAppProfileId null) fall back to env META_APP_ID/SECRET. This
  // legacy fallback must be preserved.
  let creds: MetaAppCredentials | null = null;
  if (conn.metaAppProfileId) {
    const profile = await db.metaAppProfile.findUnique({
      where: { id: conn.metaAppProfileId },
      select: { appId: true, appSecretEnc: true, apiVersion: true },
    });
    if (!profile) {
      return {
        ...base,
        outcome: "failed",
        reason: "Meta App Profile for this connection was not found.",
      };
    }
    try {
      creds = {
        appId: profile.appId,
        appSecret: decryptToken(profile.appSecretEnc),
        apiVersion: profile.apiVersion,
      };
    } catch {
      return {
        ...base,
        outcome: "failed",
        reason: "Failed to decrypt the Meta App Profile secret.",
      };
    }
  }

  // ---- Decrypt current token (in memory only; never logged/returned) ------
  let currentToken: string;
  try {
    currentToken = decryptToken(conn.accessTokenEnc);
  } catch {
    return {
      ...base,
      outcome: "failed",
      reason: "Failed to decrypt the stored access token.",
    };
  }

  const secrets = [currentToken, creds?.appSecret ?? ""];

  // ---- Exchange: current long-lived token → fresh 60-day token ------------
  let newToken: string;
  let expiresInSec: number | undefined;
  try {
    const r = creds
      ? await exchangeForLongLivedTokenWithProfile(currentToken, creds)
      : await exchangeForLongLivedToken(currentToken);
    newToken = r.access_token;
    expiresInSec = r.expires_in;
    if (!newToken) throw new Error("Exchange response had no access_token");
  } catch (err) {
    const reason = sanitizeReason(
      `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      secrets,
    );
    await persistRotateError(conn.id, reason);
    return { ...base, outcome: "failed", reason };
  }

  // ---- Validate the NEW token BEFORE persisting anything -------------------
  // One lightweight ads_read call against this connection's own account, using
  // the same credential source's Graph URL as the exchange above.
  const graphUrl = creds
    ? `https://graph.facebook.com/${creds.apiVersion}`
    : META_GRAPH_URL;
  try {
    const params = new URLSearchParams({
      fields: "name",
      access_token: newToken,
    });
    const res = await fetch(
      `${graphUrl}/${conn.platformAccountId}?${params.toString()}`,
    );
    if (!res.ok) {
      const body = await res.text();
      const reason = sanitizeReason(
        `New token failed validation: ${res.status} ${body}`,
        [...secrets, newToken],
      );
      await persistRotateError(conn.id, reason);
      return { ...base, outcome: "failed", reason };
    }
  } catch (err) {
    const reason = sanitizeReason(
      `New token validation call failed: ${err instanceof Error ? err.message : String(err)}`,
      [...secrets, newToken],
    );
    await persistRotateError(conn.id, reason);
    return { ...base, outcome: "failed", reason };
  }

  // ---- Validation passed: the single token write ---------------------------
  const tokenExpiresAt = expiresInSec
    ? new Date(Date.now() + expiresInSec * 1000)
    : new Date(Date.now() + FALLBACK_TOKEN_LIFETIME_MS);

  await db.adAccountConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptToken(newToken),
      tokenExpiresAt,
      // Clear only rotation errors; other error types (e.g. RATE_LIMIT:)
      // belong to the sync pipeline and must survive a rotation.
      ...(conn.lastSyncError?.startsWith(ROTATE_ERROR_PREFIX)
        ? { lastSyncError: null }
        : {}),
    },
  });

  return {
    ...base,
    outcome: "rotated",
    runwayDaysAfter: runwayDays(tokenExpiresAt) ?? undefined,
  };
}

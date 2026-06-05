import crypto from "node:crypto";
import { encryptToken, decryptToken } from "@/lib/encryption";

/**
 * Pending Meta OAuth session.
 *
 * After the OAuth callback exchanges the code for a long-lived token, we do
 * NOT auto-create connections. Instead we stash the token + context in a
 * short-lived, HttpOnly, signed cookie and redirect the user to an ad-account
 * selection screen. On confirmation a server action reads this session and
 * creates/updates only the selected AdAccountConnection rows.
 *
 * Security:
 *   - The access token is encrypted at rest in the cookie with the existing
 *     AES-256-GCM helper (TOKEN_ENCRYPTION_KEY).
 *   - The whole payload is HMAC-signed (same key) to prevent tampering.
 *   - Cookie is HttpOnly + SameSite=Lax + Secure (in prod) and expires fast.
 */

export const META_PENDING_COOKIE = "meta_oauth_pending";
const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface PendingAdAccount {
  id: string; // "act_xxx"
  name: string;
  currency: string;
  timezone: string;
}

export interface PendingMetaSession {
  clientId: string;
  metaAppProfileId: string;
  // Long-lived token, encrypted with the shared helper.
  accessTokenEnc: string;
  tokenExpiresAt: string; // ISO
  accounts: PendingAdAccount[];
  issuedAt: number;
}

interface PendingPayload {
  clientId: string;
  metaAppProfileId: string;
  accessTokenEnc: string;
  tokenExpiresAt: string;
  accounts: PendingAdAccount[];
  issuedAt: number;
}

function getSecret(): string {
  return process.env.TOKEN_ENCRYPTION_KEY ?? "dev-secret";
}

/**
 * Serialize + sign a pending session into a cookie value. The access token is
 * encrypted before being placed into the payload.
 */
export function serializePendingSession(input: {
  clientId: string;
  metaAppProfileId: string;
  accessToken: string;
  tokenExpiresAt: Date;
  accounts: PendingAdAccount[];
}): string {
  const payload: PendingPayload = {
    clientId: input.clientId,
    metaAppProfileId: input.metaAppProfileId,
    accessTokenEnc: encryptToken(input.accessToken),
    tokenExpiresAt: input.tokenExpiresAt.toISOString(),
    accounts: input.accounts,
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Verify + parse a pending session cookie. Returns null if tampered/expired.
 * The access token is kept encrypted (accessTokenEnc) and only decrypted at
 * the point of persistence.
 */
export function parsePendingSession(
  cookieValue: string | undefined,
): PendingMetaSession | null {
  if (!cookieValue) return null;
  const [encoded, sig] = cookieValue.split(".");
  if (!encoded || !sig) return null;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(encoded)
    .digest("base64url");
  // Constant-time comparison.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as PendingPayload;
    if (Date.now() - payload.issuedAt > PENDING_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Decrypts the held access token from a pending session. Kept separate so the
 * plaintext token only materializes at persistence time.
 */
export function decryptPendingToken(session: PendingMetaSession): string {
  return decryptToken(session.accessTokenEnc);
}

export const PENDING_COOKIE_MAX_AGE_SEC = PENDING_TTL_MS / 1000;

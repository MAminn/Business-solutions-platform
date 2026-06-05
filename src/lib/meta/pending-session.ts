import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptToken, decryptToken } from "@/lib/encryption";

/**
 * Pending Meta OAuth session — server-side (database) storage.
 *
 * After the OAuth callback exchanges the code for a long-lived token, we do
 * NOT auto-create connections. Instead we persist the token + context in a
 * `PendingMetaOAuthSession` row and redirect the user to an ad-account
 * selection screen. Only an unguessable random session id is placed in a
 * short-lived HttpOnly cookie. On confirmation a server action reads this row
 * and creates/updates only the selected AdAccountConnection rows.
 *
 * Why DB instead of a cookie: the full session (token + entire ad-account
 * list) could exceed the browser cookie size limit for media buyers with many
 * ad accounts, silently breaking the flow.
 *
 * Security:
 *   - The access token is encrypted at rest with the existing AES-256-GCM
 *     helper (TOKEN_ENCRYPTION_KEY).
 *   - The cookie holds only a 32-byte random id; the row is the source of truth.
 *   - Cookie is HttpOnly + SameSite=Lax + Secure (in prod) and expires fast.
 *   - Rows carry their own `expiresAt` (15 min) and are validated on every read.
 */

export const META_PENDING_COOKIE = "meta_oauth_pending";
const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PENDING_COOKIE_MAX_AGE_SEC = PENDING_TTL_MS / 1000;

export interface PendingAdAccount {
  id: string; // "act_xxx"
  name: string;
  currency: string;
  timezone: string;
}

export interface PendingMetaSession {
  id: string;
  userId: string;
  organizationId: string;
  clientId: string;
  metaAppProfileId: string;
  // Long-lived token, encrypted with the shared helper. Only decrypted at the
  // point of persisting AdAccountConnection rows.
  accessTokenEnc: string;
  tokenExpiresAt: Date;
  accounts: PendingAdAccount[];
  expiresAt: Date;
}

/**
 * Cryptographically-strong, unguessable session id (32 bytes → 64 hex chars).
 */
export function generatePendingSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create a pending session row and return its id (to store in the cookie).
 * The access token is encrypted before it is written.
 */
export async function createPendingSession(input: {
  userId: string;
  organizationId: string;
  clientId: string;
  metaAppProfileId: string;
  accessToken: string;
  tokenExpiresAt: Date;
  accounts: PendingAdAccount[];
}): Promise<string> {
  const id = generatePendingSessionId();
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  await db.pendingMetaOAuthSession.create({
    data: {
      id,
      userId: input.userId,
      organizationId: input.organizationId,
      clientId: input.clientId,
      metaAppProfileId: input.metaAppProfileId,
      accessTokenEnc: encryptToken(input.accessToken),
      tokenExpiresAt: input.tokenExpiresAt,
      accounts: input.accounts as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
  });

  return id;
}

/**
 * Load + validate a pending session by cookie id.
 *
 * Returns null when the id is missing, the row does not exist, it is not owned
 * by `userId`, or it has expired. Expired rows are treated as absent (the
 * scheduled purge removes them).
 */
export async function loadPendingSession(
  cookieId: string | undefined,
  userId: string,
): Promise<PendingMetaSession | null> {
  if (!cookieId) return null;

  const row = await db.pendingMetaOAuthSession.findUnique({
    where: { id: cookieId },
  });
  if (!row) return null;
  if (row.userId !== userId) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    clientId: row.clientId,
    metaAppProfileId: row.metaAppProfileId,
    accessTokenEnc: row.accessTokenEnc,
    tokenExpiresAt: row.tokenExpiresAt,
    accounts: (row.accounts as unknown as PendingAdAccount[]) ?? [],
    expiresAt: row.expiresAt,
  };
}

/**
 * Delete a pending session row by id. Idempotent — safe to call when the row
 * was already removed or the id is undefined.
 */
export async function deletePendingSession(
  cookieId: string | undefined,
): Promise<void> {
  if (!cookieId) return;
  await db.pendingMetaOAuthSession.deleteMany({ where: { id: cookieId } });
}

/**
 * Decrypts the held access token from a pending session. Kept separate so the
 * plaintext token only materializes at persistence time.
 */
export function decryptPendingToken(session: PendingMetaSession): string {
  return decryptToken(session.accessTokenEnc);
}

/**
 * Delete all expired pending sessions. Returns the number of rows removed.
 * Called by the scheduled purge job.
 */
export async function purgeExpiredPendingSessions(): Promise<number> {
  const result = await db.pendingMetaOAuthSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptToken, decryptToken } from "@/lib/encryption";

/**
 * Pending TikTok OAuth session — server-side (database) storage.
 *
 * TikTok counterpart of lib/meta/pending-session.ts. After the OAuth callback
 * exchanges the auth code, the token + advertiser snapshot are held in a
 * `PendingTikTokOAuthSession` row until the user picks advertisers. Only the
 * unguessable row id travels in a cookie.
 *
 * Deliberately NOT a "use server" module: these functions must never be
 * callable as server actions.
 *
 * Security:
 *   - The access token is encrypted at rest (AES-256-GCM, TOKEN_ENCRYPTION_KEY)
 *     and only decrypted through `decryptPendingTikTokToken`.
 *   - Rows carry their own `expiresAt` (15 min), checked on every read. No
 *     purge job exists, so the loader enforces expiry itself and deletes
 *     expired rows it encounters.
 */

const PENDING_TTL_MS = 15 * 60 * 1000; // 15 minutes, matching Meta

export interface PendingTikTokAdvertiser {
  id: string;
  name: string;
  currency: string;
  // Verbatim from TikTok (e.g. "Etc/GMT-2" = UTC+2). Never normalized.
  timezone: string;
}

export interface PendingTikTokSession {
  id: string;
  userId: string;
  organizationId: string;
  clientId: string;
  tiktokAppProfileId: string;
  // Encrypted; use decryptPendingTikTokToken to get the plaintext.
  accessTokenEnc: string;
  // Null when TikTok returned no expiry. Never fabricated.
  tokenExpiresAt: Date | null;
  advertisers: PendingTikTokAdvertiser[];
  // Raw numeric scope ids as returned by TikTok.
  scopes: number[] | null;
  expiresAt: Date;
}

/**
 * Create a pending session row and return its id (to store in the cookie).
 * The id is 32 random bytes (64 hex chars); the token is encrypted before it
 * is written.
 */
export async function createPendingTikTokSession(input: {
  userId: string;
  organizationId: string;
  clientId: string;
  tiktokAppProfileId: string;
  accessToken: string;
  tokenExpiresAt: Date | null;
  advertisers: PendingTikTokAdvertiser[];
  scopes: number[] | null;
}): Promise<string> {
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  await db.pendingTikTokOAuthSession.create({
    data: {
      id,
      userId: input.userId,
      organizationId: input.organizationId,
      clientId: input.clientId,
      tiktokAppProfileId: input.tiktokAppProfileId,
      accessTokenEnc: encryptToken(input.accessToken),
      tokenExpiresAt: input.tokenExpiresAt,
      advertisers: input.advertisers as unknown as Prisma.InputJsonValue,
      scopes:
        input.scopes === null
          ? Prisma.DbNull
          : (input.scopes as unknown as Prisma.InputJsonValue),
      expiresAt,
    },
  });

  return id;
}

/**
 * Load + validate a pending session by cookie id.
 *
 * Returns null when the id is missing, the row does not exist, it is not owned
 * by `userId`, or it has expired. An expired row is deleted on the spot.
 */
export async function loadPendingTikTokSession(
  sessionId: string | undefined,
  userId: string,
): Promise<PendingTikTokSession | null> {
  if (!sessionId) return null;

  const row = await db.pendingTikTokOAuthSession.findUnique({
    where: { id: sessionId },
  });
  if (!row) return null;
  if (row.userId !== userId) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.pendingTikTokOAuthSession.deleteMany({
      where: { id: row.id, expiresAt: { lte: new Date() } },
    });
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    clientId: row.clientId,
    tiktokAppProfileId: row.tiktokAppProfileId,
    accessTokenEnc: row.accessTokenEnc,
    tokenExpiresAt: row.tokenExpiresAt,
    advertisers:
      (row.advertisers as unknown as PendingTikTokAdvertiser[]) ?? [],
    scopes: (row.scopes as unknown as number[] | null) ?? null,
    expiresAt: row.expiresAt,
  };
}

/**
 * Delete a pending session row by id. Idempotent.
 */
export async function deletePendingTikTokSession(
  sessionId: string | undefined,
): Promise<void> {
  if (!sessionId) return;
  await db.pendingTikTokOAuthSession.deleteMany({ where: { id: sessionId } });
}

/**
 * Decrypts the held access token. Kept separate so the plaintext token only
 * materializes where a caller explicitly asks for it.
 */
export function decryptPendingTikTokToken(
  session: PendingTikTokSession,
): string {
  return decryptToken(session.accessTokenEnc);
}

"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AdPlatform, ConnectionStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import { isTikTokConnectEnabled } from "@/lib/tiktok/flags";
import {
  TIKTOK_PENDING_COOKIE,
  tiktokPendingCookieOptions,
} from "@/lib/tiktok/oauth-cookies";
import { loadPendingTikTokSession } from "@/server/tiktok-oauth-session";

/**
 * Finalize a pending TikTok OAuth flow: turn the selected advertisers into
 * AdAccountConnection rows.
 *
 * Everything that identifies WHERE rows land (client, app profile, org, the
 * session itself) comes from server-side state — the pending cookie and the
 * session row. The form contributes advertiser ids only.
 *
 * The encrypted token is copied from the pending session as-is; it is never
 * opened here.
 *
 * All writes happen in one transaction whose first statement deletes (claims)
 * the pending session. A concurrent confirm on the same session fails that
 * delete, and any failure rolls the delete back so the operator can retry.
 */

const INTEGRATIONS_PATH = "/settings/integrations";
const SELECT_PATH = "/settings/integrations/tiktok-select";

const snapshotSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    currency: z.string().min(1),
    timezone: z.string().min(1),
  }),
);

class StateError extends Error {}
class SelectionError extends Error {}
class ConflictError extends Error {}

async function getOrgIdForUser(userId: string): Promise<string | null> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return member?.organizationId ?? null;
}

type ConfirmedConnection = {
  platformAccountId: string;
  accountName: string;
  currency: string;
  timezone: string;
  operation: "created" | "updated";
  profileChanged: boolean;
};

type ClaimResult = {
  claimed: {
    clientId: string;
    tiktokAppProfileId: string;
    tokenExpiresAt: Date | null;
    scopes: Prisma.JsonValue;
  };
  connections: ConfirmedConnection[];
};

export async function confirmTikTokAdvertisers(
  formData: FormData,
): Promise<void> {
  if (!isTikTokConnectEnabled()) {
    redirect(`${INTEGRATIONS_PATH}?error=tiktok_disabled`);
  }

  const user = await requireUser();

  // The session id comes from the cookie only — never from the form.
  const sessionId = cookies().get(TIKTOK_PENDING_COOKIE)?.value;
  const session = await loadPendingTikTokSession(sessionId, user.id);
  if (!session) {
    redirect(`${INTEGRATIONS_PATH}?error=tiktok_state`);
  }

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(session.clientId)) {
    redirect(`${INTEGRATIONS_PATH}?error=tiktok_client`);
  }

  const organizationId = await getOrgIdForUser(user.id);
  const profile = organizationId
    ? await db.tikTokAppProfile.findFirst({
        where: { id: session.tiktokAppProfileId, organizationId },
        select: { id: true },
      })
    : null;
  if (!organizationId || !profile) {
    redirect(`${INTEGRATIONS_PATH}?error=tiktok_profile`);
  }

  const selected = Array.from(
    new Set(
      formData
        .getAll("advertiserId")
        .filter((v): v is string => typeof v === "string"),
    ),
  );
  if (selected.length === 0) {
    redirect(`${SELECT_PATH}?error=tiktok_selection`);
  }

  let result: ClaimResult;
  try {
    result = await claimAndConnect(session.id, user.id, selected);
  } catch (err) {
    redirect(classify(err));
  }
  const { claimed, connections } = result;

  cookies().set(TIKTOK_PENDING_COOKIE, "", {
    ...tiktokPendingCookieOptions(),
    maxAge: 0,
  });

  for (const c of connections) {
    await writeAudit({
      userId: user.id,
      organizationId,
      action: "connection.token_set",
      entityType: "AdAccountConnection",
      entityId: c.platformAccountId,
      metadata: {
        platform: "TIKTOK",
        operation: c.operation,
        platformAccountId: c.platformAccountId,
        clientId: claimed.clientId,
        tiktokAppProfileId: claimed.tiktokAppProfileId,
        accountName: c.accountName,
        currency: c.currency,
        timezone: c.timezone,
        scopes: claimed.scopes,
        profileChanged: c.profileChanged,
        tokenExpiresAt: claimed.tokenExpiresAt?.toISOString() ?? null,
      },
    });
  }

  revalidatePath(INTEGRATIONS_PATH);
  revalidatePath(`/clients/${claimed.clientId}/ad-account`);
  redirect(`${INTEGRATIONS_PATH}?connected=${connections.length}`);
}

async function claimAndConnect(
  sessionId: string,
  userId: string,
  selected: string[],
): Promise<ClaimResult> {
  return db.$transaction(async (tx) => {
    // Atomic single-use claim: removes the row and returns it.
    const claimed = await tx.pendingTikTokOAuthSession.delete({
      where: { id: sessionId },
    });
    if (claimed.userId !== userId || claimed.expiresAt <= new Date()) {
      throw new StateError();
    }

    const snapshot = snapshotSchema.safeParse(claimed.advertisers);
    if (!snapshot.success) throw new SelectionError();
    const byId = new Map(snapshot.data.map((a) => [a.id, a]));
    const advertisers = selected.map((id) => {
      const advertiser = byId.get(id);
      if (!advertiser) throw new SelectionError();
      return advertiser;
    });

    const existing = await tx.adAccountConnection.findMany({
      where: {
        platform: AdPlatform.TIKTOK,
        platformAccountId: { in: selected },
      },
      select: {
        id: true,
        clientId: true,
        platformAccountId: true,
        tiktokAppProfileId: true,
      },
    });
    // The (platform, platformAccountId) key is global, not org-scoped: an
    // advertiser held by any other client rejects the whole batch.
    if (existing.some((row) => row.clientId !== claimed.clientId)) {
      throw new ConflictError();
    }
    const existingById = new Map(
      existing.map((row) => [row.platformAccountId, row]),
    );

    const connections: ConfirmedConnection[] = [];
    for (const advertiser of advertisers) {
      const row = existingById.get(advertiser.id);
      if (row) {
        // id, clientId and the sync timestamps are deliberately not written.
        const { count } = await tx.adAccountConnection.updateMany({
          where: {
            id: row.id,
            clientId: claimed.clientId,
            platform: AdPlatform.TIKTOK,
          },
          data: {
            accountName: advertiser.name,
            currency: advertiser.currency,
            timezone: advertiser.timezone,
            accessTokenEnc: claimed.accessTokenEnc,
            refreshTokenEnc: null,
            tokenExpiresAt: claimed.tokenExpiresAt,
            status: ConnectionStatus.ACTIVE,
            lastSyncError: null,
            tiktokAppProfileId: claimed.tiktokAppProfileId,
            metaAppProfileId: null,
          },
        });
        if (count !== 1) throw new ConflictError();
        connections.push({
          platformAccountId: advertiser.id,
          accountName: advertiser.name,
          currency: advertiser.currency,
          timezone: advertiser.timezone,
          operation: "updated",
          profileChanged: row.tiktokAppProfileId !== claimed.tiktokAppProfileId,
        });
      } else {
        await tx.adAccountConnection.create({
          data: {
            clientId: claimed.clientId,
            platform: AdPlatform.TIKTOK,
            platformAccountId: advertiser.id,
            accountName: advertiser.name,
            currency: advertiser.currency,
            timezone: advertiser.timezone,
            accessTokenEnc: claimed.accessTokenEnc,
            refreshTokenEnc: null,
            tokenExpiresAt: claimed.tokenExpiresAt,
            status: ConnectionStatus.ACTIVE,
            tiktokAppProfileId: claimed.tiktokAppProfileId,
            metaAppProfileId: null,
          },
        });
        connections.push({
          platformAccountId: advertiser.id,
          accountName: advertiser.name,
          currency: advertiser.currency,
          timezone: advertiser.timezone,
          operation: "created",
          profileChanged: false,
        });
      }
    }

    return {
      claimed: {
        clientId: claimed.clientId,
        tiktokAppProfileId: claimed.tiktokAppProfileId,
        tokenExpiresAt: claimed.tokenExpiresAt,
        scopes: claimed.scopes,
      },
      connections,
    };
  });
}

/**
 * Maps a rolled-back confirm to a redirect. Unique violations are classified
 * here, after the transaction has ended, never caught inside it.
 */
function classify(err: unknown): string {
  if (err instanceof StateError) {
    return `${INTEGRATIONS_PATH}?error=tiktok_state`;
  }
  if (err instanceof SelectionError) {
    return `${SELECT_PATH}?error=tiktok_selection`;
  }
  if (err instanceof ConflictError) {
    return `${SELECT_PATH}?error=tiktok_conflict`;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return `${INTEGRATIONS_PATH}?error=tiktok_state`;
    if (err.code === "P2002") return `${SELECT_PATH}?error=tiktok_conflict`;
  }
  return `${INTEGRATIONS_PATH}?error=unknown`;
}

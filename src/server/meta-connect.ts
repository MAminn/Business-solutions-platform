"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConnectionStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import { encryptToken } from "@/lib/encryption";
import {
  META_PENDING_COOKIE,
  loadPendingSession,
  deletePendingSession,
  decryptPendingToken,
} from "@/lib/meta/pending-session";

/**
 * Finalize a pending Meta OAuth flow.
 *
 * Reads the held (encrypted) token from the DB-backed pending session
 * (referenced by a random id in the cookie), validates the user still has
 * access to the target client, and creates/updates AdAccountConnection rows
 * ONLY for the ad accounts the user selected. The selected MetaAppProfile is
 * recorded on every connection so future sync / refresh uses the org's own app
 * credentials (never env for new connections).
 */

const confirmSchema = z.object({
  selectedAccountIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one ad account"),
});

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

/** Clear the pending-session cookie. */
function clearPendingCookie(cookieStore: ReturnType<typeof cookies>): void {
  cookieStore.set(META_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
}

export type ConfirmResult =
  | { ok: true; created: number; clientId: string }
  | { ok: false; error: string };

export async function confirmMetaAdAccounts(input: {
  selectedAccountIds: string[];
}): Promise<ConfirmResult> {
  const user = await requireUser();

  // Recoverable validation: a bad selection must NOT consume the pending
  // session, so the user can correct it and retry.
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.flatten().formErrors[0] ?? "Invalid selection.",
    };
  }

  const cookieStore = cookies();
  const cookieId = cookieStore.get(META_PENDING_COOKIE)?.value;
  const session = await loadPendingSession(cookieId, user.id);
  if (!session) {
    return {
      ok: false,
      error:
        "Your connection session expired. Please start the connection again.",
    };
  }

  // Scope: the user must still have access to the target client.
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(session.clientId)) {
    await deletePendingSession(cookieId);
    clearPendingCookie(cookieStore);
    return { ok: false, error: "You do not have access to that client." };
  }

  const organizationId = await getOrgIdForUser(user.id);

  // Scope: the selected profile must belong to the caller's org.
  const profile = await db.metaAppProfile.findFirst({
    where: { id: session.metaAppProfileId, organizationId },
    select: { id: true },
  });
  if (!profile) {
    await deletePendingSession(cookieId);
    clearPendingCookie(cookieStore);
    return {
      ok: false,
      error: "Selected Meta App Profile is no longer available.",
    };
  }

  // Only allow accounts that were actually present in the granted set.
  const grantedById = new Map(session.accounts.map((a) => [a.id, a]));
  const chosen = parsed.data.selectedAccountIds.filter((id) =>
    grantedById.has(id),
  );
  if (chosen.length === 0) {
    await deletePendingSession(cookieId);
    clearPendingCookie(cookieStore);
    return { ok: false, error: "None of the selected ad accounts are valid." };
  }

  const token = decryptPendingToken(session);
  const tokenEnc = encryptToken(token);
  const expiresAt = session.tokenExpiresAt;

  let created = 0;
  for (const accountId of chosen) {
    const account = grantedById.get(accountId)!;

    // platformAccountId is globally unique (per platform). If this ad account
    // is already attached to ANOTHER client, skip it rather than reassign.
    const conflict = await db.adAccountConnection.findUnique({
      where: {
        platform_platformAccountId: {
          platform: "META",
          platformAccountId: account.id,
        },
      },
      select: { id: true, clientId: true },
    });

    if (conflict && conflict.clientId !== session.clientId) {
      continue;
    }

    try {
      await db.adAccountConnection.upsert({
        where: {
          platform_platformAccountId: {
            platform: "META",
            platformAccountId: account.id,
          },
        },
        create: {
          clientId: session.clientId,
          platform: "META",
          platformAccountId: account.id,
          accountName: account.name,
          currency: account.currency,
          timezone: account.timezone,
          accessTokenEnc: tokenEnc,
          tokenExpiresAt: expiresAt,
          status: ConnectionStatus.ACTIVE,
          lastSyncError: null,
          metaAppProfileId: session.metaAppProfileId,
        },
        update: {
          accountName: account.name,
          currency: account.currency,
          timezone: account.timezone,
          accessTokenEnc: tokenEnc,
          tokenExpiresAt: expiresAt,
          status: ConnectionStatus.ACTIVE,
          lastSyncError: null,
          metaAppProfileId: session.metaAppProfileId,
        },
      });
      created++;
    } catch (err) {
      // A concurrent insert could race the unique constraint; treat as benign.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }

    await writeAudit({
      userId: user.id,
      organizationId,
      action: "connection.token_set",
      entityType: "AdAccountConnection",
      entityId: account.id,
      metadata: {
        clientId: session.clientId,
        platformAccountId: account.id,
        accountName: account.name,
        metaAppProfileId: session.metaAppProfileId,
        tokenExpiresAt: expiresAt.toISOString(),
      },
    });
  }

  // Consume the pending session so the token can't be reused.
  await deletePendingSession(cookieId);
  clearPendingCookie(cookieStore);

  if (created === 0) {
    return {
      ok: false,
      error:
        "The selected ad accounts are already linked to other clients and were skipped.",
    };
  }

  revalidatePath("/settings/integrations");
  revalidatePath(`/clients/${session.clientId}/ad-account`);
  return { ok: true, created, clientId: session.clientId };
}

export async function cancelMetaConnection(): Promise<{ ok: true }> {
  await requireUser();
  const cookieStore = cookies();
  const cookieId = cookieStore.get(META_PENDING_COOKIE)?.value;
  await deletePendingSession(cookieId);
  clearPendingCookie(cookieStore);
  return { ok: true };
}

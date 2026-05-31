"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import {
  syncStructural,
  syncInsightsIncremental,
  syncInsightsBackfill,
} from "@/lib/meta/sync";

const syncSchema = z.object({ connectionId: z.string().min(1) });

type SyncResult =
  | { ok: true; mode: "initial" | "incremental" }
  | { ok: false; error: string };

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

export async function syncConnectionNow(input: {
  connectionId: string;
}): Promise<SyncResult> {
  const user = await requireUser();
  const { connectionId } = syncSchema.parse(input);

  const conn = await db.adAccountConnection.findUnique({
    where: { id: connectionId },
    select: {
      id: true,
      clientId: true,
      platformAccountId: true,
      accountName: true,
      accessTokenEnc: true,
      lastSyncedAt: true,
    },
  });
  if (!conn) return { ok: false, error: "Connection not found" };

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(conn.clientId)) {
    return { ok: false, error: "Forbidden" };
  }

  if (!conn.accessTokenEnc) {
    return {
      ok: false,
      error: "Connection has no OAuth token. Click Connect first.",
    };
  }

  const mode: "initial" | "incremental" =
    conn.lastSyncedAt === null ? "initial" : "incremental";

  try {
    await syncStructural(connectionId);
    if (mode === "initial") {
      await syncInsightsBackfill(connectionId, 30);
    } else {
      await syncInsightsIncremental(connectionId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown sync error";
    const isRateLimit =
      (err instanceof Error && err.name === "MetaRateLimitError") ||
      message.startsWith("RATE_LIMIT:");
    const userError = isRateLimit
      ? "Meta rate limit reached for this ad account. Wait 30–60 minutes and try again. (Meta error code 17)"
      : message.slice(0, 500);
    try {
      const orgId = await getOrgIdForUser(user.id);
      await writeAudit({
        userId: user.id,
        organizationId: orgId,
        action: "connection.sync_failed",
        entityType: "AdAccountConnection",
        entityId: conn.id,
        metadata: {
          clientId: conn.clientId,
          platformAccountId: conn.platformAccountId,
          mode,
          error: message.slice(0, 500),
          ...(isRateLimit ? { rateLimit: true } : {}),
        },
      });
    } catch {
      // Audit failure should not mask the original error.
    }
    return { ok: false, error: userError };
  }

  const orgId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId: orgId,
    action: "connection.sync",
    entityType: "AdAccountConnection",
    entityId: conn.id,
    metadata: {
      clientId: conn.clientId,
      platformAccountId: conn.platformAccountId,
      mode,
    },
  });

  revalidatePath("/settings/integrations");
  revalidatePath(`/clients/${conn.clientId}/ad-account`);
  revalidatePath(`/clients/${conn.clientId}/campaigns`);
  revalidatePath(`/clients/${conn.clientId}/creatives`);
  revalidatePath(`/clients/${conn.clientId}`);
  revalidatePath("/dashboard");

  return { ok: true, mode };
}

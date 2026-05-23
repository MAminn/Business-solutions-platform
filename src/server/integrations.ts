"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConnectionStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";

const disconnectSchema = z.object({ id: z.string().min(1) });

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

export async function disconnectAdAccount(input: {
  id: string;
}): Promise<{ ok: true }> {
  const user = await requireUser();
  const { id } = disconnectSchema.parse(input);

  const existing = await db.adAccountConnection.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      platformAccountId: true,
      accountName: true,
    },
  });
  if (!existing) throw new Error("Connection not found");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(existing.clientId)) {
    throw new Error("Forbidden");
  }

  await db.adAccountConnection.update({
    where: { id },
    data: {
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      status: ConnectionStatus.REVOKED,
      lastSyncError: null,
    },
  });

  const orgId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId: orgId,
    action: "connection.disconnect",
    entityType: "AdAccountConnection",
    entityId: id,
    metadata: {
      clientId: existing.clientId,
      platformAccountId: existing.platformAccountId,
      accountName: existing.accountName,
    },
  });

  revalidatePath("/settings/integrations");
  revalidatePath(`/clients/${existing.clientId}/ad-account`);
  return { ok: true };
}

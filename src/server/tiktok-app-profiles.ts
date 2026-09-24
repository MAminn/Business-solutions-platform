"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { encryptToken, decryptToken } from "@/lib/encryption";
import { writeAudit } from "@/server/audit";
import { getTikTokOAuthRedirectUri } from "@/lib/tiktok/oauth";
import {
  createTikTokAppProfileSchema,
  updateTikTokAppProfileSchema,
  deleteTikTokAppProfileSchema,
  flattenTikTokAppProfileErrors,
  type TikTokAppProfileFormState,
} from "@/server/tiktok-app-profiles.schemas";

/**
 * Server actions for managing workspace-owned TikTok App Profiles.
 *
 * All reads/writes are strictly scoped by the current user's organizationId.
 * App secrets are encrypted at rest with the shared AES-256-GCM helper and are
 * NEVER returned to the client (only a masked last-4 preview is exposed).
 */

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

export interface TikTokAppProfileListItem {
  id: string;
  name: string;
  appId: string;
  apiVersion: string;
  appSecretLast4: string;
  connectionCount: number;
  createdAt: Date;
}

/**
 * Lists the current org's TikTok App Profiles. The decrypted secret never
 * leaves the server — only the last 4 characters are returned for display.
 */
export async function listTikTokAppProfiles(): Promise<
  TikTokAppProfileListItem[]
> {
  const user = await requireUser();
  const organizationId = await getOrgIdForUser(user.id);

  const profiles = await db.tikTokAppProfile.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      appId: true,
      apiVersion: true,
      appSecretEnc: true,
      createdAt: true,
      _count: { select: { connections: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return profiles.map((p) => ({
    id: p.id,
    name: p.name,
    appId: p.appId,
    apiVersion: p.apiVersion,
    appSecretLast4: maskSecretLast4(p.appSecretEnc),
    connectionCount: p._count.connections,
    createdAt: p.createdAt,
  }));
}

/**
 * Returns the OAuth redirect URI the user must whitelist in their TikTok app.
 */
export async function getTikTokOAuthRedirectUriAction(): Promise<string> {
  await requireUser();
  return getTikTokOAuthRedirectUri();
}

export async function createTikTokAppProfile(
  _prev: TikTokAppProfileFormState,
  formData: FormData,
): Promise<TikTokAppProfileFormState> {
  const user = await requireUser();
  const organizationId = await getOrgIdForUser(user.id);

  const parsed = createTikTokAppProfileSchema.safeParse({
    name: formData.get("name"),
    appId: formData.get("appId"),
    appSecret: formData.get("appSecret"),
    apiVersion: formData.get("apiVersion"),
  });
  if (!parsed.success) {
    return { errors: flattenTikTokAppProfileErrors(parsed.error) };
  }

  const data = parsed.data;

  try {
    const profile = await db.tikTokAppProfile.create({
      data: {
        organizationId,
        name: data.name,
        appId: data.appId,
        appSecretEnc: encryptToken(data.appSecret),
        apiVersion: data.apiVersion,
      },
      select: { id: true, name: true, appId: true },
    });

    await writeAudit({
      userId: user.id,
      organizationId,
      action: "tiktok_app_profile.create",
      entityType: "TikTokAppProfile",
      entityId: profile.id,
      // Never log the secret.
      metadata: { name: profile.name, appId: profile.appId },
    });

    revalidatePath("/settings/integrations");
    return { ok: true, message: "TikTok App Profile created." };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        errors: {
          appId: [
            "A profile with this App ID already exists in your workspace.",
          ],
        },
      };
    }
    throw err;
  }
}

export async function updateTikTokAppProfile(
  _prev: TikTokAppProfileFormState,
  formData: FormData,
): Promise<TikTokAppProfileFormState> {
  const user = await requireUser();
  const organizationId = await getOrgIdForUser(user.id);

  const parsed = updateTikTokAppProfileSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    appId: formData.get("appId"),
    appSecret: formData.get("appSecret"),
    apiVersion: formData.get("apiVersion"),
  });
  if (!parsed.success) {
    return { errors: flattenTikTokAppProfileErrors(parsed.error) };
  }

  const data = parsed.data;

  // Scope check: profile must belong to the caller's org.
  const existing = await db.tikTokAppProfile.findFirst({
    where: { id: data.id, organizationId },
    select: { id: true },
  });
  if (!existing) {
    return { errors: { _form: ["Profile not found."] } };
  }

  try {
    await db.tikTokAppProfile.update({
      where: { id: existing.id },
      data: {
        name: data.name,
        appId: data.appId,
        apiVersion: data.apiVersion,
        // Replace the secret only when a new one was supplied.
        ...(data.appSecret
          ? { appSecretEnc: encryptToken(data.appSecret) }
          : {}),
      },
    });

    await writeAudit({
      userId: user.id,
      organizationId,
      action: "tiktok_app_profile.update",
      entityType: "TikTokAppProfile",
      entityId: existing.id,
      metadata: {
        name: data.name,
        appId: data.appId,
        secretRotated: Boolean(data.appSecret),
      },
    });

    revalidatePath("/settings/integrations");
    return { ok: true, message: "TikTok App Profile updated." };
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        errors: {
          appId: [
            "A profile with this App ID already exists in your workspace.",
          ],
        },
      };
    }
    throw err;
  }
}

export async function deleteTikTokAppProfile(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const organizationId = await getOrgIdForUser(user.id);
  const { id } = deleteTikTokAppProfileSchema.parse(input);

  const existing = await db.tikTokAppProfile.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      name: true,
      appId: true,
      _count: { select: { connections: true } },
    },
  });
  if (!existing) {
    return { ok: false, error: "Profile not found." };
  }

  // Block deletion while any connection references this profile.
  if (existing._count.connections > 0) {
    return {
      ok: false,
      error: `Cannot delete: ${existing._count.connections} ad account connection${
        existing._count.connections === 1 ? "" : "s"
      } still use this profile. Disconnect them first.`,
    };
  }

  await db.tikTokAppProfile.delete({ where: { id: existing.id } });

  await writeAudit({
    userId: user.id,
    organizationId,
    action: "tiktok_app_profile.delete",
    entityType: "TikTokAppProfile",
    entityId: existing.id,
    metadata: { name: existing.name, appId: existing.appId },
  });

  revalidatePath("/settings/integrations");
  return { ok: true };
}

/**
 * Returns only the last 4 characters of the decrypted secret for masked
 * display. The full secret never leaves the server. If decryption fails for
 * any reason, returns a neutral mask rather than leaking details or throwing.
 */
function maskSecretLast4(appSecretEnc: string): string {
  try {
    const secret = decryptToken(appSecretEnc);
    const last4 = secret.slice(-4);
    return `••••${last4}`;
  } catch {
    return "••••";
  }
}

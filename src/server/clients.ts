"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import {
  createClientSchema,
  updateClientSchema,
  flattenClientErrors,
  type ClientFormState,
  type UpdateClientInput,
} from "@/server/clients.schemas";

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) {
    throw new Error("User has no organization membership");
  }
  return member.organizationId;
}

export async function createClient(
  _prev: ClientFormState,
  formData: FormData,
): Promise<ClientFormState> {
  const user = await requireUser();

  const parsed = createClientSchema.safeParse({
    name: formData.get("name"),
    industry: formData.get("industry"),
    monthlyBudget: formData.get("monthlyBudget"),
    targetCpa: formData.get("targetCpa"),
    targetRoas: formData.get("targetRoas"),
  });

  if (!parsed.success) {
    return { errors: flattenClientErrors(parsed.error) };
  }

  const organizationId = await getOrgIdForUser(user.id);
  const data = parsed.data;

  const created = await db.client.create({
    data: {
      organizationId,
      name: data.name,
      industry: data.industry,
      monthlyBudget: data.monthlyBudget,
      targetCpa: data.targetCpa,
      targetRoas: data.targetRoas,
      assignees: { create: { userId: user.id } },
    },
    select: { id: true },
  });

  await writeAudit({
    userId: user.id,
    organizationId,
    action: "client.create",
    entityType: "Client",
    entityId: created.id,
    metadata: { changes: data },
  });

  revalidatePath("/clients");
  redirect(`/clients/${created.id}`);
}

export async function updateClient(
  input: UpdateClientInput,
): Promise<{ ok: true } | ClientFormState> {
  const user = await requireUser();

  const parsed = updateClientSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: flattenClientErrors(parsed.error) };
  }

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(parsed.data.id)) {
    throw new Error("Forbidden");
  }

  const { id, ...changes } = parsed.data;

  const updated = await db.client.update({
    where: { id },
    data: {
      name: changes.name,
      industry: changes.industry,
      monthlyBudget: changes.monthlyBudget,
      targetCpa: changes.targetCpa,
      targetRoas: changes.targetRoas,
      status: changes.status,
      health: changes.health,
      notes: changes.notes,
    },
    select: { id: true, organizationId: true },
  });

  await writeAudit({
    userId: user.id,
    organizationId: updated.organizationId,
    action: "client.update",
    entityType: "Client",
    entityId: updated.id,
    metadata: { changes },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

export async function deleteClient(input: {
  id: string;
}): Promise<{ ok: true }> {
  const user = await requireUser();

  const id = z.string().min(1).parse(input.id);

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(id)) {
    throw new Error("Forbidden");
  }

  const existing = await db.client.findUnique({
    where: { id },
    select: { id: true, organizationId: true, name: true },
  });
  if (!existing) {
    throw new Error("Client not found");
  }

  await db.client.delete({ where: { id } });

  await writeAudit({
    userId: user.id,
    organizationId: existing.organizationId,
    action: "client.delete",
    entityType: "Client",
    entityId: id,
    metadata: { changes: { name: existing.name } },
  });

  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

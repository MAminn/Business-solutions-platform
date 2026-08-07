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
  resolveBillingProfile,
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
    logoUrl: formData.get("logoUrl"),
    monthlyBudget: formData.get("monthlyBudget"),
    minCpa: formData.get("minCpa"),
    maxCpa: formData.get("maxCpa"),
    minRoas: formData.get("minRoas"),
    metaAdAccountId: formData.get("metaAdAccountId"),
    metaAccountName: formData.get("metaAccountName"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
    // Loopa commercial / billing profile — read explicitly, field by field.
    billingEnabled: formData.get("billingEnabled"),
    serviceFeeAmount: formData.get("serviceFeeAmount"),
    serviceFeeCurrency: formData.get("serviceFeeCurrency"),
    billingContactName: formData.get("billingContactName"),
    billingContactEmail: formData.get("billingContactEmail"),
    billingCycleStartDate: formData.get("billingCycleStartDate"),
  });

  if (!parsed.success) {
    return { errors: flattenClientErrors(parsed.error) };
  }

  const data = parsed.data;
  const organizationId = await getOrgIdForUser(user.id);

  // Billing profile only. This commit creates NO BillingCycle, no installment,
  // no payment, no email-delivery row, and sends no email.
  const billing = resolveBillingProfile(data);

  // Determine whether full Meta connection is provided (all four fields).
  const hasMeta =
    data.metaAdAccountId !== undefined &&
    data.metaAccountName !== undefined &&
    data.currency !== undefined &&
    data.timezone !== undefined;

  if (hasMeta) {
    const existing = await db.adAccountConnection.findUnique({
      where: {
        platform_platformAccountId: {
          platform: "META",
          platformAccountId: data.metaAdAccountId!,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return {
        errors: {
          metaAdAccountId: [
            "This Meta ad account is already attached to another client.",
          ],
        },
      };
    }
  }

  const result = await db.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        organizationId,
        name: data.name,
        industry: data.industry,
        logoUrl: data.logoUrl,
        monthlyBudget: data.monthlyBudget,
        minCpa: data.minCpa,
        maxCpa: data.maxCpa,
        minRoas: data.minRoas,
        ...(data.currency ? { reportingCurrency: data.currency } : {}),
        // Loopa service fee — explicitly mapped, all six columns.
        // `monthlyBudget` above is the client's ADVERTISING budget and is
        // deliberately untouched by any of this.
        billingEnabled: billing.billingEnabled,
        serviceFeeAmount: billing.serviceFeeAmount,
        serviceFeeCurrency: billing.serviceFeeCurrency,
        billingContactName: billing.billingContactName,
        billingContactEmail: billing.billingContactEmail,
        billingCycleStartDate: billing.billingCycleStartDate,
        assignees: { create: { userId: user.id } },
        ...(hasMeta
          ? {
              adAccountConnections: {
                create: {
                  platform: "META" as const,
                  platformAccountId: data.metaAdAccountId!,
                  accountName: data.metaAccountName!,
                  currency: data.currency!,
                  timezone: data.timezone!,
                  status: "ACTIVE" as const,
                  accessTokenEnc: null,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        adAccountConnections: hasMeta
          ? {
              select: {
                id: true,
                platformAccountId: true,
                currency: true,
                timezone: true,
              },
            }
          : false,
      },
    });
    return client;
  });

  await writeAudit({
    userId: user.id,
    organizationId,
    action: "client.create",
    entityType: "Client",
    entityId: result.id,
    metadata: {
      changes: {
        name: data.name,
        industry: data.industry,
        logoUrl: data.logoUrl,
        monthlyBudget: data.monthlyBudget,
        minCpa: data.minCpa,
        maxCpa: data.maxCpa,
        minRoas: data.minRoas,
      },
    },
  });

  if (
    hasMeta &&
    result.adAccountConnections &&
    result.adAccountConnections[0]
  ) {
    const conn = result.adAccountConnections[0];
    await writeAudit({
      userId: user.id,
      organizationId,
      action: "connection.create",
      entityType: "AdAccountConnection",
      entityId: conn.id,
      metadata: {
        platformAccountId: conn.platformAccountId,
        currency: conn.currency,
        timezone: conn.timezone,
      },
    });
  }

  revalidatePath("/clients");
  redirect(`/clients/${result.id}`);
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

  // Tri-state billing:
  //   billingEnabled === undefined -> caller does not manage billing; every
  //     billing column is left untouched (Prisma reads `undefined` as no-change)
  //   billingEnabled === true       -> write the full profile
  //   billingEnabled === false      -> explicitly clear the profile
  // This commit never touches BillingCycle / BillingInstallment / BillingPayment
  // rows; turning billing off only clears the Client-level configuration.
  const billing =
    changes.billingEnabled === undefined
      ? null
      : resolveBillingProfile(changes);

  const updated = await db.client.update({
    where: { id },
    data: {
      name: changes.name,
      industry: changes.industry,
      logoUrl: changes.logoUrl,
      monthlyBudget: changes.monthlyBudget,
      minCpa: changes.minCpa,
      maxCpa: changes.maxCpa,
      minRoas: changes.minRoas,
      status: changes.status,
      health: changes.health,
      notes: changes.notes,
      // All six billing columns intentionally mapped.
      billingEnabled: billing ? billing.billingEnabled : undefined,
      serviceFeeAmount: billing ? billing.serviceFeeAmount : undefined,
      serviceFeeCurrency: billing ? billing.serviceFeeCurrency : undefined,
      billingContactName: billing ? billing.billingContactName : undefined,
      billingContactEmail: billing ? billing.billingContactEmail : undefined,
      billingCycleStartDate: billing
        ? billing.billingCycleStartDate
        : undefined,
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

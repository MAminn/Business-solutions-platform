"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

async function assertAccessToClient(
  user: User,
  clientId: string,
): Promise<void> {
  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(clientId)) {
    throw new Error("Forbidden");
  }
}

const createFundingCycleSchema = z.object({
  adAccountConnectionId: z.string().min(1, "Connection is required"),
  amount: z.coerce
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than 0"),
  note: z
    .string()
    .trim()
    .max(1000, "Note is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

const cancelFundingCycleSchema = z.object({
  fundingCycleId: z.string().min(1, "Funding cycle is required"),
});

export type CreateFundingCycleInput = z.input<typeof createFundingCycleSchema>;
export type CancelFundingCycleInput = z.input<typeof cancelFundingCycleSchema>;

export type FundingFormErrorKey =
  | "adAccountConnectionId"
  | "amount"
  | "note"
  | "_form";

export interface FundingFormState {
  errors?: Partial<Record<FundingFormErrorKey, string[]>>;
  message?: string;
}

export interface FundingCycleListItem {
  id: string;
  amount: number;
  currency: string;
  startedAt: Date;
  note: string | null;
  cancelledAt: Date | null;
  isActive: boolean;
}

/**
 * Index of the active cycle: the most recent (rows are startedAt desc) whose
 * cancelledAt is null. Returns -1 when every cycle is cancelled (none active).
 * Pure. Kept module-private because this is a "use server" file (only async
 * functions may be exported).
 */
function activeCycleIndex(cycles: { cancelledAt: Date | null }[]): number {
  return cycles.findIndex((c) => c.cancelledAt === null);
}

export async function createFundingCycle(
  input: CreateFundingCycleInput,
): Promise<FundingFormState> {
  const user = await requireUser();

  const parsed = createFundingCycleSchema.safeParse(input);
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      errors: {
        adAccountConnectionId: flat.adAccountConnectionId,
        amount: flat.amount,
        note: flat.note,
      },
    };
  }

  const data = parsed.data;

  const connection = await db.adAccountConnection.findUnique({
    where: { id: data.adAccountConnectionId },
    select: { id: true, clientId: true, currency: true },
  });
  if (!connection) {
    return { errors: { _form: ["Connection not found"] } };
  }

  await assertAccessToClient(user, connection.clientId);

  const cycle = await db.fundingCycle.create({
    data: {
      adAccountConnectionId: connection.id,
      amount: data.amount,
      currency: connection.currency,
      note: data.note,
    },
    select: { id: true },
  });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "funding_cycle.create",
    entityType: "FundingCycle",
    entityId: cycle.id,
    metadata: {
      adAccountConnectionId: connection.id,
      clientId: connection.clientId,
      amount: data.amount,
      currency: connection.currency,
    },
  });

  revalidatePath(`/clients/${connection.clientId}/ad-account`);
  return { message: "Funding cycle logged" };
}

export async function cancelFundingCycle(
  input: CancelFundingCycleInput,
): Promise<FundingFormState> {
  const user = await requireUser();

  const parsed = cancelFundingCycleSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: { _form: ["Invalid funding cycle"] } };
  }

  const cycle = await db.fundingCycle.findUnique({
    where: { id: parsed.data.fundingCycleId },
    select: {
      id: true,
      cancelledAt: true,
      adAccountConnectionId: true,
      adAccountConnection: { select: { clientId: true } },
    },
  });
  if (!cycle || !cycle.adAccountConnection) {
    return { errors: { _form: ["Funding cycle not found"] } };
  }

  const clientId = cycle.adAccountConnection.clientId;
  await assertAccessToClient(user, clientId);

  // Idempotent: an already-cancelled cycle is a no-op success; never overwrite
  // the original timestamp.
  if (cycle.cancelledAt !== null) {
    return { message: "Funding cycle cancelled" };
  }

  await db.fundingCycle.update({
    where: { id: cycle.id },
    data: { cancelledAt: new Date() },
  });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "funding_cycle.cancel",
    entityType: "FundingCycle",
    entityId: cycle.id,
    metadata: {
      adAccountConnectionId: cycle.adAccountConnectionId,
      clientId,
    },
  });

  revalidatePath(`/clients/${clientId}/ad-account`);
  return { message: "Funding cycle cancelled" };
}

export async function listFundingCycles(
  adAccountConnectionId: string,
): Promise<FundingCycleListItem[]> {
  const user = await requireUser();

  const connection = await db.adAccountConnection.findUnique({
    where: { id: adAccountConnectionId },
    select: { id: true, clientId: true },
  });
  if (!connection) throw new Error("Connection not found");

  await assertAccessToClient(user, connection.clientId);

  const cycles = await db.fundingCycle.findMany({
    where: { adAccountConnectionId },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      amount: true,
      currency: true,
      startedAt: true,
      note: true,
      cancelledAt: true,
    },
  });

  // Active = most recent non-cancelled cycle (rows are startedAt desc), not
  // simply index 0, since index 0 could itself be cancelled.
  const activeIdx = activeCycleIndex(cycles);

  return cycles.map((cycle, index) => ({
    id: cycle.id,
    amount: Number(cycle.amount),
    currency: cycle.currency,
    startedAt: cycle.startedAt,
    note: cycle.note,
    cancelledAt: cycle.cancelledAt,
    isActive: index === activeIdx,
  }));
}

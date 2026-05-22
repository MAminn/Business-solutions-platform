"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import {
  createStrategySchema,
  updateStrategySchema,
  addObjectiveSchema,
  updateObjectiveSchema,
  flattenStrategyErrors,
  type CreateStrategyInput,
  type UpdateStrategyInput,
  type AddObjectiveInput,
  type UpdateObjectiveInput,
  type StrategyFormState,
} from "@/server/strategy.schemas";

async function getOrgIdForUser(userId: string): Promise<string> {
  const member = await db.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  if (!member) throw new Error("User has no organization membership");
  return member.organizationId;
}

function revalidateClient(clientId: string) {
  revalidatePath(`/clients/${clientId}/strategy`);
  revalidatePath(`/clients/${clientId}`);
}

export async function createStrategy(
  input: CreateStrategyInput,
): Promise<{ ok: true; id: string } | StrategyFormState> {
  const user = await requireUser();
  const parsed = createStrategySchema.safeParse(input);
  if (!parsed.success) {
    return { errors: flattenStrategyErrors(parsed.error) };
  }
  const data = parsed.data;

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(data.clientId)) {
    throw new Error("Forbidden");
  }

  const existingActive = await db.strategy.findFirst({
    where: { clientId: data.clientId, status: "ACTIVE" },
    select: { id: true },
  });
  if (existingActive) {
    return {
      errors: {
        _form: [
          "A strategy is already active for this client. Archive it before creating a new one.",
        ],
      },
    };
  }

  const organizationId = await getOrgIdForUser(user.id);

  const strategy = await db.strategy.create({
    data: {
      clientId: data.clientId,
      name: data.name,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      monthlyBudget: data.monthlyBudget,
      revenueGoal: data.revenueGoal,
      conversionGoal: data.conversionGoal,
      minCpa: data.minCpa,
      maxCpa: data.maxCpa,
      minRoas: data.minRoas,
      notes: data.notes,
    },
    select: { id: true },
  });

  await writeAudit({
    userId: user.id,
    organizationId,
    action: "strategy.create",
    entityType: "Strategy",
    entityId: strategy.id,
    metadata: {
      clientId: data.clientId,
      name: data.name,
      periodStart: data.periodStart.toISOString(),
      periodEnd: data.periodEnd.toISOString(),
      revenueGoal: data.revenueGoal,
      monthlyBudget: data.monthlyBudget,
      minCpa: data.minCpa,
      maxCpa: data.maxCpa,
      minRoas: data.minRoas,
      conversionGoal: data.conversionGoal,
    },
  });

  revalidateClient(data.clientId);
  return { ok: true, id: strategy.id };
}

export async function updateStrategy(
  input: UpdateStrategyInput,
): Promise<{ ok: true } | StrategyFormState> {
  const user = await requireUser();
  const parsed = updateStrategySchema.safeParse(input);
  if (!parsed.success) {
    return { errors: flattenStrategyErrors(parsed.error) };
  }
  const data = parsed.data;

  const existing = await db.strategy.findUnique({
    where: { id: data.id },
    select: { id: true, clientId: true, status: true },
  });
  if (!existing) throw new Error("Strategy not found");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(existing.clientId)) {
    throw new Error("Forbidden");
  }

  if (data.status === "ACTIVE" && existing.status !== "ACTIVE") {
    const otherActive = await db.strategy.findFirst({
      where: {
        clientId: existing.clientId,
        status: "ACTIVE",
        NOT: { id: existing.id },
      },
      select: { id: true },
    });
    if (otherActive) {
      return {
        errors: {
          _form: [
            "A strategy is already active for this client. Archive it before creating a new one.",
          ],
        },
      };
    }
  }

  const changes: Prisma.StrategyUpdateInput = {};
  if (data.name !== undefined) changes.name = data.name;
  if (data.status !== undefined) changes.status = data.status;
  if (data.periodStart !== undefined) changes.periodStart = data.periodStart;
  if (data.periodEnd !== undefined) changes.periodEnd = data.periodEnd;
  if (data.monthlyBudget !== undefined)
    changes.monthlyBudget = data.monthlyBudget;
  if (data.revenueGoal !== undefined) changes.revenueGoal = data.revenueGoal;
  if (data.conversionGoal !== undefined)
    changes.conversionGoal = data.conversionGoal;
  if (data.minCpa !== undefined) changes.minCpa = data.minCpa;
  if (data.maxCpa !== undefined) changes.maxCpa = data.maxCpa;
  if (data.minRoas !== undefined) changes.minRoas = data.minRoas;
  if (data.notes !== undefined) changes.notes = data.notes;

  await db.strategy.update({ where: { id: data.id }, data: changes });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "strategy.update",
    entityType: "Strategy",
    entityId: data.id,
    metadata: { id: data.id, changes: { ...data } },
  });

  revalidateClient(existing.clientId);
  return { ok: true };
}

export async function archiveStrategy(input: {
  id: string;
}): Promise<{ ok: true }> {
  const user = await requireUser();
  const existing = await db.strategy.findUnique({
    where: { id: input.id },
    select: { id: true, clientId: true },
  });
  if (!existing) throw new Error("Strategy not found");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(existing.clientId)) {
    throw new Error("Forbidden");
  }

  await db.strategy.update({
    where: { id: existing.id },
    data: { status: "ARCHIVED" },
  });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "strategy.archive",
    entityType: "Strategy",
    entityId: existing.id,
    metadata: { id: existing.id, clientId: existing.clientId },
  });

  revalidateClient(existing.clientId);
  return { ok: true };
}

export async function addObjective(
  input: AddObjectiveInput,
): Promise<{ ok: true } | StrategyFormState> {
  const user = await requireUser();
  const parsed = addObjectiveSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: flattenStrategyErrors(parsed.error) };
  }
  const data = parsed.data;

  const parent = await db.strategy.findUnique({
    where: { id: data.strategyId },
    select: { id: true, clientId: true },
  });
  if (!parent) throw new Error("Strategy not found");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(parent.clientId)) {
    throw new Error("Forbidden");
  }

  try {
    await db.strategyObjective.create({
      data: {
        strategyId: data.strategyId,
        type: data.type,
        allocatedBudget: data.allocatedBudget,
        notes: data.notes,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return {
        errors: { type: ["This objective is already in the strategy."] },
      };
    }
    throw err;
  }

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "strategy_objective.create",
    entityType: "StrategyObjective",
    entityId: data.strategyId,
    metadata: {
      strategyId: data.strategyId,
      type: data.type,
      allocatedBudget: data.allocatedBudget,
    },
  });

  revalidateClient(parent.clientId);
  return { ok: true };
}

export async function updateObjective(
  input: UpdateObjectiveInput,
): Promise<{ ok: true } | StrategyFormState> {
  const user = await requireUser();
  const parsed = updateObjectiveSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: flattenStrategyErrors(parsed.error) };
  }
  const data = parsed.data;

  const existing = await db.strategyObjective.findUnique({
    where: { id: data.id },
    select: { id: true, strategy: { select: { clientId: true } } },
  });
  if (!existing) throw new Error("Objective not found");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(existing.strategy.clientId)) {
    throw new Error("Forbidden");
  }

  const changes: Prisma.StrategyObjectiveUpdateInput = {};
  if (data.type !== undefined) changes.type = data.type;
  if (data.allocatedBudget !== undefined)
    changes.allocatedBudget = data.allocatedBudget;
  if (data.notes !== undefined) changes.notes = data.notes;

  await db.strategyObjective.update({ where: { id: data.id }, data: changes });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "strategy_objective.update",
    entityType: "StrategyObjective",
    entityId: data.id,
    metadata: { id: data.id, changes: { ...data } },
  });

  revalidateClient(existing.strategy.clientId);
  return { ok: true };
}

export async function removeObjective(input: {
  id: string;
}): Promise<{ ok: true }> {
  const user = await requireUser();
  const existing = await db.strategyObjective.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      strategyId: true,
      type: true,
      strategy: { select: { clientId: true } },
    },
  });
  if (!existing) throw new Error("Objective not found");

  const accessible = await getAccessibleClientIds(user);
  if (!accessible.includes(existing.strategy.clientId)) {
    throw new Error("Forbidden");
  }

  await db.strategyObjective.delete({ where: { id: existing.id } });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "strategy_objective.delete",
    entityType: "StrategyObjective",
    entityId: existing.id,
    metadata: { strategyId: existing.strategyId, type: existing.type },
  });

  revalidateClient(existing.strategy.clientId);
  return { ok: true };
}

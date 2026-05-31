"use server";

import { revalidatePath } from "next/cache";
import { TaskSource } from "@prisma/client";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, getAccessibleClientIds } from "@/lib/auth";
import { writeAudit } from "@/server/audit";
import { storeTaskAttachment, MAX_ATTACHMENT_BYTES } from "@/lib/uploads";
import {
  createTaskSchema,
  updateTaskStatusSchema,
  deleteTaskSchema,
  flattenTaskErrors,
  type TaskFormState,
  type UpdateTaskStatusInput,
  type DeleteTaskInput,
} from "@/server/tasks.schemas";

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

function revalidateTaskPaths(clientId: string): void {
  revalidatePath(`/clients/${clientId}/tasks`);
  revalidatePath("/ops");
  revalidatePath(`/clients/${clientId}`);
}

export async function createTask(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const user = await requireUser();

  const statusRaw = formData.get("status");
  const parsed = createTaskSchema.safeParse({
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    priority: formData.get("priority"),
    status: statusRaw === null || statusRaw === "" ? "TODO" : statusRaw,
    description: formData.get("description") ?? undefined,
    rule: formData.get("rule") ?? undefined,
  });

  if (!parsed.success) {
    return { errors: flattenTaskErrors(parsed.error) };
  }

  const data = parsed.data;
  await assertAccessToClient(user, data.clientId);

  const files = formData
    .getAll("attachments")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const oversized = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  if (oversized) {
    return {
      errors: {
        _form: [`"${oversized.name}" exceeds the 10 MB attachment limit.`],
      },
    };
  }

  const task = await db.task.create({
    data: {
      clientId: data.clientId,
      title: data.title,
      priority: data.priority,
      status: data.status,
      description: data.description,
      rule: data.rule,
      source: TaskSource.MANUAL,
      createdById: user.id,
    },
    select: { id: true, clientId: true },
  });

  if (files.length > 0) {
    const stored = await Promise.all(
      files.map((file) => storeTaskAttachment(task.id, file)),
    );
    await db.taskAttachment.createMany({
      data: stored.map((s) => ({
        taskId: task.id,
        fileName: s.fileName,
        url: s.url,
        size: s.size,
        mimeType: s.mimeType,
      })),
    });
  }

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "task.create",
    entityType: "Task",
    entityId: task.id,
    metadata: {
      clientId: task.clientId,
      title: data.title,
      priority: data.priority,
      status: data.status,
      source: "MANUAL",
      attachmentCount: files.length,
    },
  });

  revalidateTaskPaths(task.clientId);
  return { message: "Task created" };
}

export async function updateTaskStatus(
  input: UpdateTaskStatusInput,
): Promise<{ ok: true }> {
  const user = await requireUser();
  const parsed = updateTaskStatusSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid input");
  }
  const { id, status } = parsed.data;

  const existing = await db.task.findUnique({
    where: { id },
    select: { id: true, clientId: true, status: true },
  });
  if (!existing) throw new Error("Task not found");

  await assertAccessToClient(user, existing.clientId);

  if (existing.status === status) {
    return { ok: true };
  }

  await db.task.update({
    where: { id },
    data: {
      status,
      completedAt: status === "DONE" ? new Date() : null,
    },
  });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "task.update",
    entityType: "Task",
    entityId: id,
    metadata: { from: existing.status, to: status },
  });

  revalidateTaskPaths(existing.clientId);
  return { ok: true };
}

export async function deleteTask(
  input: DeleteTaskInput,
): Promise<{ ok: true }> {
  const user = await requireUser();
  const parsed = deleteTaskSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid input");
  }
  const { id } = parsed.data;

  const existing = await db.task.findUnique({
    where: { id },
    select: { id: true, clientId: true, title: true },
  });
  if (!existing) throw new Error("Task not found");

  await assertAccessToClient(user, existing.clientId);

  await db.task.delete({ where: { id } });

  const organizationId = await getOrgIdForUser(user.id);
  await writeAudit({
    userId: user.id,
    organizationId,
    action: "task.delete",
    entityType: "Task",
    entityId: id,
    metadata: { clientId: existing.clientId, title: existing.title },
  });

  revalidateTaskPaths(existing.clientId);
  return { ok: true };
}

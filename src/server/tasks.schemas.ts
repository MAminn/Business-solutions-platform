import { z } from "zod";
import { TaskPriority, TaskStatus } from "@prisma/client";

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const createTaskSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title is too long"),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.MED),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.TODO),
  description: optionalTrimmed(2000, "Description"),
  rule: optionalTrimmed(200, "Rule"),
});

export const updateTaskStatusSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(TaskStatus),
});

export const deleteTaskSchema = z.object({
  id: z.string().min(1),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskStatusInput = z.input<typeof updateTaskStatusSchema>;
export type DeleteTaskInput = z.input<typeof deleteTaskSchema>;

export type TaskFormErrorKey =
  | "clientId"
  | "title"
  | "priority"
  | "status"
  | "description"
  | "rule"
  | "_form";

const TASK_ERROR_KEYS: ReadonlySet<TaskFormErrorKey> = new Set([
  "clientId",
  "title",
  "priority",
  "status",
  "description",
  "rule",
  "_form",
]);

export interface TaskFormState {
  errors?: Partial<Record<TaskFormErrorKey, string[]>>;
  message?: string;
}

export function flattenTaskErrors(error: z.ZodError): TaskFormState["errors"] {
  const fieldErrors = error.flatten().fieldErrors;
  const out: NonNullable<TaskFormState["errors"]> = {};
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (!v || v.length === 0) continue;
    if (TASK_ERROR_KEYS.has(k as TaskFormErrorKey)) {
      out[k as TaskFormErrorKey] = v;
    }
  }
  return out;
}

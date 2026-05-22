import { z } from "zod";
import type { ClientStatus, ClientHealth } from "@prisma/client";

const optionalNumber = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      const trimmed = v.trim();
      if (trimmed === "") return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : NaN;
    })
    .refine(
      (v) =>
        v === undefined ||
        (typeof v === "number" && Number.isFinite(v) && v >= 0),
      {
        message: `${label} must be a non-negative number`,
      },
    )
    .optional();

export const createClientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  industry: z
    .string()
    .trim()
    .max(120, "Industry is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  monthlyBudget: optionalNumber("Monthly budget"),
  targetCpa: optionalNumber("Target CPA"),
  targetRoas: optionalNumber("Target ROAS"),
});

export const updateClientSchema = createClientSchema.extend({
  id: z.string().min(1),
  status: z.enum([
    "ACTIVE",
    "PAUSED",
    "CHURNED",
    "PROSPECT",
  ]) satisfies z.ZodType<ClientStatus>,
  health: z.enum([
    "EXCELLENT",
    "GOOD",
    "NEEDS_ATTENTION",
    "AT_RISK",
  ]) satisfies z.ZodType<ClientHealth>,
  notes: z.string().max(10_000).optional(),
});

export type CreateClientInput = z.input<typeof createClientSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;

export interface ClientFormState {
  errors?: Partial<
    Record<
      | "name"
      | "industry"
      | "monthlyBudget"
      | "targetCpa"
      | "targetRoas"
      | "_form",
      string[]
    >
  >;
  message?: string;
}

export function flattenClientErrors(
  error: z.ZodError,
): ClientFormState["errors"] {
  const fieldErrors = error.flatten().fieldErrors;
  const out: ClientFormState["errors"] = {};
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (v && v.length > 0) {
      out[k as keyof NonNullable<ClientFormState["errors"]>] = v;
    }
  }
  return out;
}

import { z } from "zod";
import { CampaignObjectiveType, StrategyStatus } from "@prisma/client";

const optionalNonNegNumber = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      const t = v.trim();
      if (t === "") return undefined;
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    })
    .refine(
      (v) =>
        v === undefined ||
        (typeof v === "number" && Number.isFinite(v) && v >= 0),
      { message: `${label} must be a non-negative number` },
    )
    .optional();

const optionalNonNegInt = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      const t = v.trim();
      if (t === "") return undefined;
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    })
    .refine(
      (v) =>
        v === undefined ||
        (typeof v === "number" &&
          Number.isFinite(v) &&
          Number.isInteger(v) &&
          v >= 0),
      { message: `${label} must be a non-negative integer` },
    )
    .optional();

const requiredNonNegNumber = (label: string) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === "number" ? v : Number(String(v).trim())))
    .refine((v) => Number.isFinite(v) && v >= 0, {
      message: `${label} must be a non-negative number`,
    });

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

export const createStrategySchema = z
  .object({
    clientId: z.string().min(1),
    name: optionalTrimmed(120, "Name"),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    monthlyBudget: optionalNonNegNumber("Monthly budget"),
    revenueGoal: optionalNonNegNumber("Revenue goal"),
    conversionGoal: optionalNonNegInt("Conversion goal"),
    minCpa: optionalNonNegNumber("Min CPA"),
    maxCpa: optionalNonNegNumber("Max CPA"),
    minRoas: optionalNonNegNumber("Min ROAS"),
    notes: optionalTrimmed(10_000, "Notes"),
  })
  .superRefine((v, ctx) => {
    if (v.periodEnd < v.periodStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "End date must be on or after start date",
      });
    }
    if (
      v.minCpa !== undefined &&
      v.maxCpa !== undefined &&
      v.maxCpa < v.minCpa
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCpa"],
        message: "Max CPA must be ≥ Min CPA",
      });
    }
  });

export const updateStrategySchema = z
  .object({
    id: z.string().min(1),
    name: optionalTrimmed(120, "Name"),
    status: z.nativeEnum(StrategyStatus).optional(),
    periodStart: z.coerce.date().optional(),
    periodEnd: z.coerce.date().optional(),
    monthlyBudget: optionalNonNegNumber("Monthly budget"),
    revenueGoal: optionalNonNegNumber("Revenue goal"),
    conversionGoal: optionalNonNegInt("Conversion goal"),
    minCpa: optionalNonNegNumber("Min CPA"),
    maxCpa: optionalNonNegNumber("Max CPA"),
    minRoas: optionalNonNegNumber("Min ROAS"),
    notes: optionalTrimmed(10_000, "Notes"),
  })
  .superRefine((v, ctx) => {
    if (
      v.periodStart &&
      v.periodEnd &&
      v.periodEnd < v.periodStart
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "End date must be on or after start date",
      });
    }
    if (
      v.minCpa !== undefined &&
      v.maxCpa !== undefined &&
      v.maxCpa < v.minCpa
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCpa"],
        message: "Max CPA must be ≥ Min CPA",
      });
    }
  });

export const addObjectiveSchema = z.object({
  strategyId: z.string().min(1),
  type: z.nativeEnum(CampaignObjectiveType),
  allocatedBudget: requiredNonNegNumber("Allocated budget"),
  notes: optionalTrimmed(1000, "Notes"),
});

export const updateObjectiveSchema = z.object({
  id: z.string().min(1),
  type: z.nativeEnum(CampaignObjectiveType).optional(),
  allocatedBudget: optionalNonNegNumber("Allocated budget"),
  notes: optionalTrimmed(1000, "Notes"),
});

export type CreateStrategyInput = z.input<typeof createStrategySchema>;
export type UpdateStrategyInput = z.input<typeof updateStrategySchema>;
export type AddObjectiveInput = z.input<typeof addObjectiveSchema>;
export type UpdateObjectiveInput = z.input<typeof updateObjectiveSchema>;

type StrategyFormErrorKey =
  | "name"
  | "periodStart"
  | "periodEnd"
  | "monthlyBudget"
  | "revenueGoal"
  | "conversionGoal"
  | "minCpa"
  | "maxCpa"
  | "minRoas"
  | "notes"
  | "status"
  | "type"
  | "allocatedBudget"
  | "_form";

const STRATEGY_ERROR_KEYS: ReadonlySet<StrategyFormErrorKey> = new Set([
  "name",
  "periodStart",
  "periodEnd",
  "monthlyBudget",
  "revenueGoal",
  "conversionGoal",
  "minCpa",
  "maxCpa",
  "minRoas",
  "notes",
  "status",
  "type",
  "allocatedBudget",
  "_form",
]);

export interface StrategyFormState {
  errors?: Partial<Record<StrategyFormErrorKey, string[]>>;
  message?: string;
}

export function flattenStrategyErrors(
  error: z.ZodError,
): StrategyFormState["errors"] {
  const fieldErrors = error.flatten().fieldErrors;
  const out: NonNullable<StrategyFormState["errors"]> = {};
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (!v || v.length === 0) continue;
    if (STRATEGY_ERROR_KEYS.has(k as StrategyFormErrorKey)) {
      out[k as StrategyFormErrorKey] = v;
    }
  }
  return out;
}

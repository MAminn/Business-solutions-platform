import { z } from "zod";
import type { ClientStatus, ClientHealth } from "@prisma/client";
import { SUPPORTED_CURRENCIES, COMMON_TIMEZONES } from "@/lib/locale";

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

const optionalTrimmedString = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .pipe(z.string().url("Must be a valid URL").optional());

const optionalCurrency = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .pipe(
    z
      .enum(SUPPORTED_CURRENCIES, {
        errorMap: () => ({ message: "Unsupported currency" }),
      })
      .optional(),
  );

const optionalTimezone = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .pipe(
    z
      .enum(COMMON_TIMEZONES, {
        errorMap: () => ({ message: "Unsupported timezone" }),
      })
      .optional(),
  );

const optionalMetaAccountId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .pipe(
    z
      .string()
      .regex(/^act_\d+$/, "Format must be act_followed_by_digits")
      .optional(),
  );

export const createClientSchema = z
  .object({
    // Section A
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name is too long"),
    industry: optionalTrimmedString(120, "Industry"),
    logoUrl: optionalUrl,
    // Section B
    monthlyBudget: optionalNumber("Monthly budget"),
    minCpa: optionalNumber("Min CPA"),
    maxCpa: optionalNumber("Max CPA"),
    minRoas: optionalNumber("Min ROAS"),
    // Section C — Meta ad account (all-or-nothing)
    metaAdAccountId: optionalMetaAccountId,
    metaAccountName: optionalTrimmedString(120, "Meta account name"),
    currency: optionalCurrency,
    timezone: optionalTimezone,
  })
  .superRefine((val, ctx) => {
    // CPA range
    if (
      val.minCpa !== undefined &&
      val.maxCpa !== undefined &&
      val.maxCpa < val.minCpa
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCpa"],
        message: "Max CPA must be ≥ Min CPA",
      });
    }

    // All-or-nothing for Meta ad account fields
    const metaFields = [
      val.metaAdAccountId,
      val.metaAccountName,
      val.currency,
      val.timezone,
    ];
    const filled = metaFields.filter((f) => f !== undefined).length;
    if (filled >= 1 && filled <= 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metaAdAccountId"],
        message:
          "Either fill in all Meta ad account fields or leave them all empty.",
      });
    }
  });

export const updateClientSchema = z
  .object({
    id: z.string().min(1),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name is too long"),
    industry: optionalTrimmedString(120, "Industry"),
    logoUrl: optionalUrl,
    monthlyBudget: optionalNumber("Monthly budget"),
    minCpa: optionalNumber("Min CPA"),
    maxCpa: optionalNumber("Max CPA"),
    minRoas: optionalNumber("Min ROAS"),
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
  })
  .superRefine((val, ctx) => {
    if (
      val.minCpa !== undefined &&
      val.maxCpa !== undefined &&
      val.maxCpa < val.minCpa
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCpa"],
        message: "Max CPA must be ≥ Min CPA",
      });
    }
  });

export type CreateClientInput = z.input<typeof createClientSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;

type ClientFormErrorKey =
  | "name"
  | "industry"
  | "logoUrl"
  | "monthlyBudget"
  | "minCpa"
  | "maxCpa"
  | "minRoas"
  | "metaAdAccountId"
  | "metaAccountName"
  | "currency"
  | "timezone"
  | "_form";

const FORM_ERROR_KEYS: ReadonlySet<ClientFormErrorKey> = new Set([
  "name",
  "industry",
  "logoUrl",
  "monthlyBudget",
  "minCpa",
  "maxCpa",
  "minRoas",
  "metaAdAccountId",
  "metaAccountName",
  "currency",
  "timezone",
  "_form",
]);

export interface ClientFormState {
  errors?: Partial<Record<ClientFormErrorKey, string[]>>;
  message?: string;
}

export function flattenClientErrors(
  error: z.ZodError,
): ClientFormState["errors"] {
  const fieldErrors = error.flatten().fieldErrors;
  const out: NonNullable<ClientFormState["errors"]> = {};
  for (const [k, v] of Object.entries(fieldErrors)) {
    if (!v || v.length === 0) continue;
    if (FORM_ERROR_KEYS.has(k as ClientFormErrorKey)) {
      out[k as ClientFormErrorKey] = v;
    }
  }
  return out;
}

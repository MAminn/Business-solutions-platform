import { z } from "zod";
import type { ClientStatus, ClientHealth } from "@prisma/client";
import { SUPPORTED_CURRENCIES, COMMON_TIMEZONES } from "@/lib/locale";
import {
  piastersFromDecimalString,
  piastersToDecimalString,
} from "@/server/billing-math";

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

// ---------------------------------------------------------------------------
// Loopa commercial / billing profile (fixed-fee, EGP, 50/50).
//
// These fields describe LOOPA'S OWN SERVICE FEE and are entirely separate from
// `monthlyBudget`, which is the client's ADVERTISING budget consumed by
// overview pacing. Nothing here reads, writes, or changes the meaning of
// `monthlyBudget`.
//
// The fee is validated as an exact decimal STRING and converted through integer
// piasters (src/server/billing-math.ts). It never passes through parseFloat,
// Number(), or an <input type="number">, because binary floating point silently
// loses or gains a piaster (4.35 * 100 === 434.99999999999994).
// ---------------------------------------------------------------------------

/**
 * Raw optional text straight off a form. Tolerates `null`, which is what
 * `FormData.get()` returns for an absent field (an unchecked checkbox, or an
 * input that is disabled while billing is switched off).
 */
const optionalRawText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (typeof v !== "string") return undefined;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });

/**
 * Length-capped variant of `optionalRawText`. Needed because the billing inputs
 * are disabled while billing is off, and a disabled input is omitted from the
 * submission — so `FormData.get()` yields `null`, which the plain
 * `optionalTrimmedString` helper (string-only) rejects.
 */
const optionalRawTextMax = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (typeof v !== "string") return undefined;
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .pipe(z.string().max(max, `${label} is too long`).optional());

/** Create-form flag: an absent checkbox means "billing off". */
const createBillingEnabledFlag = z
  .union([z.boolean(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v !== "string") return false;
    const s = v.trim().toLowerCase();
    return s === "true" || s === "on" || s === "1";
  });

/**
 * Edit flag, deliberately TRI-STATE:
 *   true      -> billing on, full billing payload required
 *   false     -> billing explicitly turned off, profile fields are cleared
 *   undefined -> caller does not manage billing; every billing column is left
 *                untouched (Prisma treats `undefined` as "no change")
 *
 * The undefined case is what stops a caller that knows nothing about billing
 * from silently wiping a configured profile just by saving the sheet.
 */
const updateBillingEnabledFlag = z
  .union([z.boolean(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v !== "string") return undefined;
    const s = v.trim().toLowerCase();
    if (s === "") return undefined;
    return s === "true" || s === "on" || s === "1";
  });

/** Exact money: up to 10 integer digits, at most 2 decimals. Mirrors Decimal(12,2). */
const EXACT_MONEY_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/** Strict calendar date. No other format is accepted. */
const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True when `value` is a real calendar date in strict YYYY-MM-DD form.
 * Built with Date.UTC only — the string is never handed to `new Date(string)`,
 * so the server's local timezone can never shift the day.
 */
function isValidCivilDate(value: string): boolean {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * A validated YYYY-MM-DD civil date as a Date at UTC midnight — exactly the
 * shape Prisma expects for a `@db.Date` column, and what B-1's schema documents
 * as an Africa/Cairo civil date. No local-timezone interpretation anywhere.
 */
export function civilDateToUtcDate(value: string): Date {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Not a valid YYYY-MM-DD civil date: ${value}`);
  }
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
}

interface BillingFieldsInput {
  billingEnabled?: boolean;
  serviceFeeAmount?: string;
  serviceFeeCurrency?: string;
  billingContactName?: string;
  billingContactEmail?: string;
  billingCycleStartDate?: string;
}

/**
 * Billing cross-field validation, shared by create and update so the two can
 * never drift apart.
 *
 * Only runs when billing is explicitly ON. When billing is off (or unmanaged)
 * the billing inputs are ignored entirely, because the server action hard-nulls
 * every billing column in that case — so a stale value left in a switched-off
 * field can never reach the database.
 */
function refineBillingFields(
  val: BillingFieldsInput,
  ctx: z.RefinementCtx,
): void {
  if (val.billingEnabled !== true) return;

  // --- Monthly service fee -------------------------------------------------
  if (val.serviceFeeAmount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceFeeAmount"],
      message: "Monthly service fee is required when billing is enabled",
    });
  } else if (!EXACT_MONEY_PATTERN.test(val.serviceFeeAmount)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceFeeAmount"],
      message:
        "Enter an amount in EGP with at most 2 decimal places (e.g. 10000 or 10000.01)",
    });
  } else {
    let piasters: number | null = null;
    try {
      piasters = piastersFromDecimalString(val.serviceFeeAmount);
    } catch {
      piasters = null;
    }
    if (piasters === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceFeeAmount"],
        message: "Monthly service fee is not a valid EGP amount",
      });
    } else if (piasters <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serviceFeeAmount"],
        message: "Monthly service fee must be greater than zero",
      });
    }
  }

  // --- Currency (EGP only in v1) ------------------------------------------
  if (val.serviceFeeCurrency !== "EGP") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceFeeCurrency"],
      message: "Billing currency must be EGP",
    });
  }

  // --- Billing contact email ----------------------------------------------
  if (val.billingContactEmail === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billingContactEmail"],
      message: "Billing contact email is required when billing is enabled",
    });
  } else if (!z.string().email().safeParse(val.billingContactEmail).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billingContactEmail"],
      message: "Enter a valid billing contact email",
    });
  }

  // --- Billing cycle start date -------------------------------------------
  if (val.billingCycleStartDate === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billingCycleStartDate"],
      message: "Billing cycle start date is required when billing is enabled",
    });
  } else if (!isValidCivilDate(val.billingCycleStartDate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["billingCycleStartDate"],
      message: "Enter a valid date in YYYY-MM-DD format",
    });
  }
}

/** Exactly the six Client billing columns, ready to hand to Prisma. */
export interface BillingProfileWrite {
  billingEnabled: boolean;
  serviceFeeAmount: string | null;
  serviceFeeCurrency: string | null;
  billingContactName: string | null;
  billingContactEmail: string | null;
  billingCycleStartDate: Date | null;
}

/**
 * Map validated billing input onto the six Client columns.
 *
 * Enabled: the fee is normalised through integer piasters, so what reaches
 * Prisma is an exact canonical decimal string ("10000.1" -> "10000.10").
 * Disabled: every profile column is explicitly cleared to null.
 *
 * Must only be called on input that has already passed `refineBillingFields`.
 */
export function resolveBillingProfile(
  val: BillingFieldsInput,
): BillingProfileWrite {
  if (val.billingEnabled !== true) {
    return {
      billingEnabled: false,
      serviceFeeAmount: null,
      serviceFeeCurrency: null,
      billingContactName: null,
      billingContactEmail: null,
      billingCycleStartDate: null,
    };
  }

  if (
    val.serviceFeeAmount === undefined ||
    val.billingContactEmail === undefined ||
    val.billingCycleStartDate === undefined
  ) {
    throw new Error(
      "resolveBillingProfile called with incomplete billing input; validation must run first",
    );
  }

  return {
    billingEnabled: true,
    // string -> integer piasters -> canonical string. No float ever involved.
    serviceFeeAmount: piastersToDecimalString(
      piastersFromDecimalString(val.serviceFeeAmount),
    ),
    serviceFeeCurrency: "EGP",
    billingContactName: val.billingContactName ?? null,
    billingContactEmail: val.billingContactEmail,
    billingCycleStartDate: civilDateToUtcDate(val.billingCycleStartDate),
  };
}

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
    // Section D — Loopa commercial / billing profile (NOT the ad budget)
    billingEnabled: createBillingEnabledFlag,
    serviceFeeAmount: optionalRawText,
    serviceFeeCurrency: optionalRawText,
    billingContactName: optionalRawTextMax(120, "Billing contact name"),
    billingContactEmail: optionalRawText,
    billingCycleStartDate: optionalRawText,
  })
  .superRefine((val, ctx) => {
    refineBillingFields(val, ctx);

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
    // Loopa commercial / billing profile. `billingEnabled` is tri-state here:
    // omit it entirely to leave every billing column untouched.
    billingEnabled: updateBillingEnabledFlag,
    serviceFeeAmount: optionalRawText,
    serviceFeeCurrency: optionalRawText,
    billingContactName: optionalRawTextMax(120, "Billing contact name"),
    billingContactEmail: optionalRawText,
    billingCycleStartDate: optionalRawText,
  })
  .superRefine((val, ctx) => {
    refineBillingFields(val, ctx);

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
  // Loopa commercial / billing profile. `serviceFeeCurrency` is deliberately
  // distinct from `currency`, which belongs to the Meta ad account.
  | "billingEnabled"
  | "serviceFeeAmount"
  | "serviceFeeCurrency"
  | "billingContactName"
  | "billingContactEmail"
  | "billingCycleStartDate"
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
  "billingEnabled",
  "serviceFeeAmount",
  "serviceFeeCurrency",
  "billingContactName",
  "billingContactEmail",
  "billingCycleStartDate",
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

import { z } from "zod";

/**
 * Validation schemas + form-state types for TikTokAppProfile management.
 * Mirrors meta-app-profiles.schemas.ts (Zod + flattened field errors).
 */

const MIN_API_VERSION = /^v\d+\.\d+$/;

export const DEFAULT_TIKTOK_API_VERSION = "v1.3";

export const createTikTokAppProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  appId: z
    .string()
    .trim()
    .min(1, "App ID is required")
    .max(64, "App ID is too long")
    .regex(/^\d+$/, "App ID must be numeric"),
  appSecret: z
    .string()
    .trim()
    .min(1, "App Secret is required")
    .max(256, "App Secret is too long"),
  // Missing (FormData.get → null) or blank falls back to the default version.
  apiVersion: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z
      .string()
      .trim()
      .min(1, "API version is required")
      .max(12, "API version is too long")
      .regex(MIN_API_VERSION, "Format must be like v1.3.")
      .default(DEFAULT_TIKTOK_API_VERSION),
  ),
});

export const updateTikTokAppProfileSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  appId: z
    .string()
    .trim()
    .min(1, "App ID is required")
    .max(64, "App ID is too long")
    .regex(/^\d+$/, "App ID must be numeric"),
  // Optional on edit — empty means "keep existing secret".
  appSecret: z
    .string()
    .trim()
    .max(256, "App Secret is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  apiVersion: z
    .string()
    .trim()
    .min(1, "API version is required")
    .max(12, "API version is too long")
    .regex(MIN_API_VERSION, "Format must be like v1.3."),
});

export const deleteTikTokAppProfileSchema = z.object({
  id: z.string().min(1),
});

export type TikTokAppProfileErrors = {
  name?: string[];
  appId?: string[];
  appSecret?: string[];
  apiVersion?: string[];
  _form?: string[];
};

export type TikTokAppProfileFormState = {
  errors?: TikTokAppProfileErrors;
  message?: string;
  ok?: boolean;
};

export function flattenTikTokAppProfileErrors(
  error: z.ZodError,
): TikTokAppProfileErrors {
  const f = error.flatten().fieldErrors;
  return {
    name: f.name,
    appId: f.appId,
    appSecret: f.appSecret,
    apiVersion: f.apiVersion,
  };
}

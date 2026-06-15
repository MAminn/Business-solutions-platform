/**
 * Display-only creative-name cleanup.
 *
 * Meta Dynamic Product Ad / Catalog creatives store raw template tokens like
 * "{{product.name}}" in Creative.name, which render verbatim as card/drawer
 * titles. This pure helper strips those tokens for display and falls back to a
 * sensible label when nothing meaningful remains. Render-time only — it never
 * mutates the stored value.
 */

import type { CreativeType } from "@prisma/client";

const TOKEN_RE = /\{\{[^}]*\}\}/g;

// Separators / stray punctuation to trim from the edges after token removal.
const EDGE_TRIM_RE = /^[\s\-_.·|/]+|[\s\-_.·|/]+$/g;

/** A string is "meaningful" if it contains at least one letter or digit. */
function isMeaningful(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

/** Strip Meta template tokens, collapse whitespace, and trim edge separators. */
function clean(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(TOKEN_RE, " ")
    .replace(/\s+/g, " ")
    .replace(EDGE_TRIM_RE, "")
    .trim();
}

export function cleanCreativeName(input: {
  name: string | null;
  headline?: string | null;
  type: CreativeType;
}): string {
  const cleanedName = clean(input.name);
  if (isMeaningful(cleanedName)) return cleanedName;

  const cleanedHeadline = clean(input.headline);
  if (isMeaningful(cleanedHeadline)) return cleanedHeadline;

  return input.type === "DPA" ? "Dynamic product ad" : "Untitled creative";
}

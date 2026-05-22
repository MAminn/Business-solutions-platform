import type { CampaignObjectiveType } from "@prisma/client";

export const OBJECTIVE_LABEL: Record<CampaignObjectiveType, string> = {
  SALES: "Sales",
  LEADS: "Leads",
  TRAFFIC: "Traffic",
  ENGAGEMENT: "Engagement",
  AWARENESS: "Awareness",
  APP_PROMOTION: "App promotion",
  OTHER: "Other",
};

// Map Meta's objective strings (current and legacy) into our enum.
// Unknown / null → OTHER.
export function normalizeMetaObjective(
  raw: string | null | undefined,
): CampaignObjectiveType {
  if (!raw) return "OTHER";
  const k = raw.toUpperCase();
  if (
    k.includes("SALES") ||
    k === "CONVERSIONS" ||
    k === "PRODUCT_CATALOG_SALES" ||
    k === "STORE_VISITS"
  )
    return "SALES";
  if (k.includes("LEAD") || k === "MESSAGES") return "LEADS";
  if (
    k.includes("TRAFFIC") ||
    k === "LINK_CLICKS" ||
    k === "LANDING_PAGE_VIEWS"
  )
    return "TRAFFIC";
  if (
    k.includes("ENGAGEMENT") ||
    k === "POST_ENGAGEMENT" ||
    k === "PAGE_LIKES" ||
    k === "EVENT_RESPONSES" ||
    k === "VIDEO_VIEWS"
  )
    return "ENGAGEMENT";
  if (k.includes("AWARENESS") || k === "REACH") return "AWARENESS";
  if (k.includes("APP")) return "APP_PROMOTION";
  return "OTHER";
}

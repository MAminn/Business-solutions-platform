// Pure, dependency-free grouping of Creative rows into asset cards.
//
// Many Creative rows (typically one per ad) can point at the same underlying
// asset/post and would otherwise render as duplicate cards. This collapses them
// using a fixed key chain. Kept as a single source of truth so the page and its
// acceptance test share one implementation.

export interface CreativeAssetKeyFields {
  id: string;
  effectiveObjectStoryId?: string | null;
  objectStoryId?: string | null;
  videoId?: string | null;
  imageHash?: string | null;
  imageUrl?: string | null;
}

/** Strip query string (CDN signing / cache-busting params differ per row). */
export function normalizeImageUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Resolve the asset grouping key for a creative row using the key chain:
 * effectiveObjectStoryId -> objectStoryId -> videoId -> imageHash ->
 * normalized imageUrl -> id (no-merge fallback).
 */
export function creativeAssetKey(cr: CreativeAssetKeyFields): string {
  return (
    cr.effectiveObjectStoryId ??
    cr.objectStoryId ??
    cr.videoId ??
    cr.imageHash ??
    normalizeImageUrl(cr.imageUrl) ??
    cr.id
  );
}

/**
 * Group creative rows into asset cards, preserving first-seen order of groups
 * and member order within each group.
 */
export function groupCreativesByAsset<T extends CreativeAssetKeyFields>(
  creatives: T[],
): T[][] {
  const groups = new Map<string, T[]>();
  for (const cr of creatives) {
    const key = creativeAssetKey(cr);
    const list = groups.get(key) ?? [];
    list.push(cr);
    groups.set(key, list);
  }
  return Array.from(groups.values());
}

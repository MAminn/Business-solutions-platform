import {
  previousCompletedMonth,
  monthStartUTC,
  monthEndUTC,
} from "@/lib/month";
import type { AnalysisPreset } from "@/server/analysis";

// ============================================================================
// Shared date-window helpers.
//
// Canonical UTC date math + range resolution, extracted from
// src/server/analysis.ts so future surfaces can import the same logic. All
// date math is UTC-based because InsightsDaily.date is a `@db.Date` column
// (UTC midnight). The `AnalysisPreset` type is imported type-only to avoid a
// runtime import cycle with analysis.ts.
// ============================================================================

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a yyyy-MM-dd string to a UTC-midnight Date. */
export function dayUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function isoUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** TZ-safe short label from a UTC-midnight Date. */
export function labelUTC(d: Date): string {
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function isValidIsoDate(s: string | undefined): s is string {
  return (
    !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayUTC(s).getTime())
  );
}

/** Structural shape of what `resolveRanges` reads (avoids importing the full
 * `AnalysisParams` and the runtime cycle that would create). */
interface ResolveRangesParams {
  preset: AnalysisPreset;
  /** yyyy-MM-dd — only used when preset === "custom". */
  start?: string;
  end?: string;
}

/**
 * Resolve the [start, end] window (inclusive, UTC) and the immediately
 * preceding equal-length comparison window, anchored on the latest data date.
 */
export function resolveRanges(
  params: ResolveRangesParams,
  latest: Date,
): { start: Date; end: Date; prevStart: Date; prevEnd: Date; days: number } {
  let start: Date;
  let end: Date;

  if (params.preset === "prev_month") {
    const spec = previousCompletedMonth(latest);
    start = monthStartUTC(spec);
    end = monthEndUTC(spec);
  } else if (
    params.preset === "custom" &&
    isValidIsoDate(params.start) &&
    isValidIsoDate(params.end)
  ) {
    start = dayUTC(params.start);
    end = dayUTC(params.end);
    if (start.getTime() > end.getTime()) {
      const tmp = start;
      start = end;
      end = tmp;
    }
  } else {
    // "7" or "30" (default) — window ends on the latest data date.
    const span = params.preset === "7" ? 7 : 30;
    end = latest;
    start = addDaysUTC(latest, -(span - 1));
  }

  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const prevEnd = addDaysUTC(start, -1);
  const prevStart = addDaysUTC(prevEnd, -(days - 1));
  return { start, end, prevStart, prevEnd, days };
}

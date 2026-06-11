// ============================================================================
// Calendar-month window + coverage helpers.
//
// Shared by the monthly digest (src/server/digest.ts) and the monthly
// creative bundle (src/app/api/connections/[connectionId]/creative-bundle).
// All date math is UTC-based because InsightsDaily.date is a `@db.Date`
// column, which Prisma returns as a Date at UTC midnight.
// ============================================================================

export interface MonthSpec {
  year: number;
  /** 1-12 */
  month: number;
}

/** The previous completed calendar month relative to `now` (UTC). */
export function previousCompletedMonth(now: Date = new Date()): MonthSpec {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based current month
  return m === 0 ? { year: y - 1, month: 12 } : { year: y, month: m };
}

export function prevMonthOf(spec: MonthSpec): MonthSpec {
  return spec.month === 1
    ? { year: spec.year - 1, month: 12 }
    : { year: spec.year, month: spec.month - 1 };
}

export function isValidMonthSpec(spec: MonthSpec): boolean {
  return (
    Number.isInteger(spec.year) &&
    spec.year >= 2000 &&
    spec.year <= 2100 &&
    Number.isInteger(spec.month) &&
    spec.month >= 1 &&
    spec.month <= 12
  );
}

/** First day of the month, UTC midnight. */
export function monthStartUTC(spec: MonthSpec): Date {
  return new Date(Date.UTC(spec.year, spec.month - 1, 1));
}

/** Last day of the month, UTC midnight (inclusive bound for @db.Date). */
export function monthEndUTC(spec: MonthSpec): Date {
  return new Date(Date.UTC(spec.year, spec.month, 0));
}

export function daysInMonth(spec: MonthSpec): number {
  return new Date(Date.UTC(spec.year, spec.month, 0)).getUTCDate();
}

/** "2026-05" */
export function monthLabel(spec: MonthSpec): string {
  return `${spec.year}-${String(spec.month).padStart(2, "0")}`;
}

/** "2026-05-03" for day-of-month 3. */
export function monthDayKey(spec: MonthSpec, day: number): string {
  return `${monthLabel(spec)}-${String(day).padStart(2, "0")}`;
}

/** UTC day key ("yyyy-MM-dd") for a stored @db.Date value. */
export function dayKeyUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface MonthCoverage {
  presentDays: number;
  totalDays: number;
  /** Human-readable missing ranges, e.g. "2026-05-03 → 2026-05-05". */
  missingRanges: string[];
  complete: boolean;
}

/**
 * Compares the set of day keys that actually have insight rows against every
 * calendar day of the month, compressing missing days into ranges.
 */
export function computeMonthCoverage(
  spec: MonthSpec,
  presentKeys: ReadonlySet<string>,
): MonthCoverage {
  const totalDays = daysInMonth(spec);
  const missingDays: number[] = [];
  let presentDays = 0;
  for (let d = 1; d <= totalDays; d++) {
    if (presentKeys.has(monthDayKey(spec, d))) presentDays++;
    else missingDays.push(d);
  }

  const missingRanges: string[] = [];
  let i = 0;
  while (i < missingDays.length) {
    let j = i;
    while (
      j + 1 < missingDays.length &&
      missingDays[j + 1] === missingDays[j] + 1
    ) {
      j++;
    }
    const from = monthDayKey(spec, missingDays[i]);
    const to = monthDayKey(spec, missingDays[j]);
    missingRanges.push(from === to ? from : `${from} → ${to}`);
    i = j + 1;
  }

  return {
    presentDays,
    totalDays,
    missingRanges,
    complete: missingRanges.length === 0,
  };
}

/** The shared coverage line used in both the digest and bundle manifest. */
export function coverageLine(cov: MonthCoverage): string {
  return `${cov.presentDays} of ${cov.totalDays} days with account/campaign insight data`;
}

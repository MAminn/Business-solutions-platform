// ============================================================================
// Africa/Cairo civil-date helpers for client billing.
//
// Pure and side-effect free: no I/O, no DB, no env, no module-level Date.now().
// Every function here is deterministic given its arguments.
//
// THE CORE RULE: a billing date is a civil calendar date — a (year, month, day)
// triple — not an instant. An instant is converted to a Cairo civil date ONCE,
// at the boundary (cairoDayUtc), and all arithmetic afterwards happens on that
// civil date represented as a JS Date at UTC midnight.
//
// UTC midnight is the chosen representation because that is exactly what Prisma
// returns for a `@db.Date` column, the same convention already used for
// InsightsDaily.date (see src/lib/month.ts). So a value produced here can be
// written straight to a @db.Date column and read back unchanged.
//
// WHY NOT MILLISECOND ARITHMETIC: Egypt reintroduced DST in 2023 (last Friday
// of April through last Thursday of October), so Africa/Cairo is UTC+2 or UTC+3
// depending on the date. Adding 24h * n milliseconds to a zoned instant, or
// hardcoding a +2 offset, silently produces the wrong calendar day around the
// two annual transitions. Date.UTC(y, m, d + n) is immune because it operates on
// the civil triple directly. src/lib/date-window.ts `addDaysUTC` uses
// millisecond arithmetic; it is correct for its own already-UTC-midnight inputs
// but is the wrong tool for a Cairo-anchored value, which is why these helpers
// are separate rather than an extension of that module.
// ============================================================================

const CAIRO_TIME_ZONE = "Africa/Cairo";

/** Reusable formatter — construction is the expensive part of Intl. */
const CAIRO_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid Date`);
  }
}

/**
 * Guards this module's contract: the value is a civil date represented at UTC
 * midnight. Catches the single most likely misuse — passing a raw instant (e.g.
 * `new Date()`) where a civil date is expected — which is precisely how
 * off-by-one-day billing bugs are introduced.
 */
function assertUtcMidnight(value: Date, label: string): void {
  assertValidDate(value, label);
  if (value.getTime() % 86_400_000 !== 0) {
    throw new Error(
      `${label} must be a civil date at UTC midnight (got ${value.toISOString()}). ` +
        `Convert an instant with cairoDayUtc() first.`,
    );
  }
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
}

/**
 * The Africa/Cairo civil calendar date of `instant`, as a Date at UTC midnight.
 *
 * This is the ONLY place an instant becomes a billing date. Everything
 * downstream works on the returned civil date.
 *
 * Example: any instant that falls on August 1st in Cairo returns
 * 2026-08-01T00:00:00.000Z — including 2026-07-31T22:00:00Z, which is already
 * August 1st in Cairo while still July 31st in UTC.
 *
 * `instant` is REQUIRED and deliberately has no default: this module stays
 * fully pure and deterministic, so it never reads the clock itself. Callers
 * that genuinely need the current Cairo day pass `cairoDayUtc(new Date())`
 * explicitly at the application boundary.
 */
export function cairoDayUtc(instant: Date): Date {
  assertValidDate(instant, "instant");

  const parts = CAIRO_PARTS_FORMATTER.formatToParts(instant);
  const read = (type: "year" | "month" | "day"): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl did not return a ${type} part`);
    return Number(part.value);
  };

  return new Date(Date.UTC(read("year"), read("month") - 1, read("day")));
}

/**
 * Add (or subtract, with a negative `days`) whole calendar days to a civil date.
 * Month and year rollover are handled by Date.UTC itself.
 */
export function addCalendarDays(dayUtc: Date, days: number): Date {
  assertUtcMidnight(dayUtc, "dayUtc");
  assertInteger(days, "days");

  return new Date(
    Date.UTC(
      dayUtc.getUTCFullYear(),
      dayUtc.getUTCMonth(),
      dayUtc.getUTCDate() + days,
    ),
  );
}

/**
 * Add (or subtract) whole calendar months to a civil date, preserving the
 * day-of-month where the target month has one, and clamping to that month's
 * last day where it does not.
 *
 *   2026-01-31 + 1 month -> 2026-02-28   (clamped, non-leap)
 *   2028-01-31 + 1 month -> 2028-02-29   (clamped, leap)
 *   2026-12-15 + 1 month -> 2027-01-15   (preserved, year rollover)
 *
 * Clamping rather than overflowing matters for billing periods: a cycle that
 * starts on the 31st must not silently jump into the month after next.
 */
export function addCalendarMonths(dayUtc: Date, months: number): Date {
  assertUtcMidnight(dayUtc, "dayUtc");
  assertInteger(months, "months");

  const day = dayUtc.getUTCDate();

  // Anchor on day 1 so the intermediate value can never overflow the month.
  const targetMonthStart = new Date(
    Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth() + months, 1),
  );
  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth();

  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(targetYear, targetMonth, Math.min(day, lastDayOfTargetMonth)),
  );
}

/**
 * "YYYY-MM-DD" for a civil date. Intended only for UTC-midnight values, which
 * is enforced — `toISOString().slice(0, 10)` on a raw instant is a classic
 * source of off-by-one dates and must never be used in its place.
 */
export function formatBillingDay(dayUtc: Date): string {
  assertUtcMidnight(dayUtc, "dayUtc");

  const year = String(dayUtc.getUTCFullYear()).padStart(4, "0");
  const month = String(dayUtc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dayUtc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

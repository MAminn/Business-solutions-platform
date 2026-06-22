import { formatMultiplier } from "@/lib/format";

// ---------------------------------------------------------------------------
// Pure compute helpers for the dashboard "Console" decision layer.
// No DB access, no side effects. Input is already-fetched, already-computed
// values from the dashboard page; output is a sorted list of Flags.
// ---------------------------------------------------------------------------

export type FlagSeverity = "CRITICAL" | "WARNING" | "STALE";

export interface Flag {
  clientId: string;
  clientName: string;
  severity: FlagSeverity;
  label: string;
  detail: string;
}

/** One active client's already-computed signals for flag derivation. */
export interface DashboardFlagClient {
  clientId: string;
  clientName: string;
  /** True when insights are missing or older than the freshness window. */
  isStale: boolean;
  /** Whole days since the latest data date, or null when never synced. */
  staleDays: number | null;
  /** Month-to-date pacing as a percent of monthly budget (0..N). */
  pacing: number;
  /** Trailing-30d Meta-reported ROAS. */
  roas: number;
  /** Client's minimum acceptable ROAS target, or null when unset. */
  minRoas: number | null;
}

export type PaceState = "over" | "under" | "stalled" | "healthy" | "stale";

/**
 * Pace verdict for a client. Stale clients get no confident verdict — they
 * resolve to "stale" so the UI renders a neutral/muted tone.
 */
export function paceState(pacing: number, isStale: boolean): PaceState {
  if (isStale) return "stale";
  if (pacing === 0) return "stalled";
  if (pacing >= 120) return "over";
  if (pacing > 0 && pacing <= 40) return "under";
  return "healthy";
}

const SEVERITY_RANK: Record<FlagSeverity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  STALE: 1,
};

interface RankedFlag extends Flag {
  _mag: number;
}

/**
 * Derive flags from already-computed client signals.
 *
 * A stale client is eligible only for a STALE flag and is suppressed from any
 * CRITICAL/WARNING performance flag — no confident verdict on stale data.
 *
 * Sort order: CRITICAL -> WARNING -> STALE, then by severity magnitude.
 */
export function buildFlags(clients: DashboardFlagClient[]): Flag[] {
  const ranked: RankedFlag[] = [];

  for (const c of clients) {
    if (c.isStale) {
      ranked.push({
        clientId: c.clientId,
        clientName: c.clientName,
        severity: "STALE",
        label: "Data not fresh",
        detail:
          c.staleDays != null
            ? `Last data ${c.staleDays}d ago`
            : "No recent data",
        _mag: c.staleDays ?? Number.MAX_SAFE_INTEGER,
      });
      continue;
    }

    // ---- Pacing flags ----------------------------------------------------
    if (c.pacing >= 120) {
      ranked.push({
        clientId: c.clientId,
        clientName: c.clientName,
        severity: "CRITICAL",
        label: "Over budget pace",
        detail: `Pacing at ${c.pacing}%`,
        _mag: c.pacing,
      });
    } else if (c.pacing === 0) {
      ranked.push({
        clientId: c.clientId,
        clientName: c.clientName,
        severity: "WARNING",
        label: "Stalled",
        detail: "No spend this month",
        _mag: 100,
      });
    } else if (c.pacing > 0 && c.pacing <= 40) {
      ranked.push({
        clientId: c.clientId,
        clientName: c.clientName,
        severity: "WARNING",
        label: "Under-pacing",
        detail: `Pacing at ${c.pacing}%`,
        _mag: 100 - c.pacing,
      });
    }

    // ---- ROAS flags ------------------------------------------------------
    if (c.minRoas != null && c.minRoas > 0) {
      const shortfall = ((c.minRoas - c.roas) / c.minRoas) * 100;
      if (c.roas < c.minRoas * 0.6) {
        ranked.push({
          clientId: c.clientId,
          clientName: c.clientName,
          severity: "CRITICAL",
          label: "ROAS far below target",
          detail: `${formatMultiplier(c.roas)} vs ${formatMultiplier(c.minRoas)} target`,
          _mag: shortfall,
        });
      } else if (c.roas < c.minRoas) {
        ranked.push({
          clientId: c.clientId,
          clientName: c.clientName,
          severity: "WARNING",
          label: "ROAS below target",
          detail: `${formatMultiplier(c.roas)} vs ${formatMultiplier(c.minRoas)} target`,
          _mag: shortfall,
        });
      }
    }
  }

  ranked.sort((a, b) => {
    const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rankDiff !== 0) return rankDiff;
    return b._mag - a._mag;
  });

  return ranked.map(({ _mag, ...flag }) => flag);
}

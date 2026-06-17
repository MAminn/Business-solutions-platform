import { db } from "@/lib/db";
import { InsightEntity } from "@prisma/client";

// ============================================================================
// Fund-threshold evaluator (A4).
//
// Pure compute + a LOG-ONLY DB-backed runner. This module sends NO email,
// writes NO FundAlertSent rows, makes NO Meta API calls, and performs NO
// writes of any kind. Sending + dedupe persistence is A5.
//
// Spend is Meta self-reported. It is NOT reconciled against real sales —
// every returned value and log line is labelled Meta-reported.
// ============================================================================

const DEFAULT_THRESHOLDS = [50, 75, 90, 100];

export interface FundThresholdResult {
  fundAmount: number;
  spendToDate: number; // Meta-reported
  percentSpent: number; // 0..(>100 possible), Meta-reported
  crossedThresholds: number[]; // sorted asc, those <= percentSpent
  highestCrossed: number | null;
}

/**
 * Pure evaluator — no I/O, no Date.now(), no DB, no env. Deterministic and
 * unit-testable. spendToDate / percentSpent are Meta-reported figures.
 */
export function evaluateFundThresholds(input: {
  fundAmount: number;
  spendToDate: number;
  thresholds?: number[];
}): FundThresholdResult {
  const { fundAmount, spendToDate } = input;
  const thresholds = (input.thresholds ?? DEFAULT_THRESHOLDS)
    .slice()
    .sort((a, b) => a - b);

  // Guard divide-by-zero / non-positive fund: no percent, no false alerts.
  const percentSpent = fundAmount > 0 ? (spendToDate / fundAmount) * 100 : 0;

  const crossedThresholds =
    fundAmount > 0 ? thresholds.filter((t) => t <= percentSpent) : [];

  const highestCrossed =
    crossedThresholds.length > 0
      ? crossedThresholds[crossedThresholds.length - 1]
      : null;

  return {
    fundAmount,
    spendToDate,
    percentSpent,
    crossedThresholds,
    highestCrossed,
  };
}

type FundAlertCheckResult =
  | { status: "no_active_cycle" }
  | { status: "insufficient_data" }
  | {
      status: "evaluated";
      cycleId: string;
      currency: string;
      result: FundThresholdResult;
    };

/**
 * Log-only, read-only runner. Reads the active funding cycle and sums
 * account-level Meta-reported spend since the cycle started, then evaluates
 * thresholds and logs the result. Writes NOTHING. No email, no FundAlertSent
 * access, no Meta API call, no revalidate.
 */
export async function runFundAlertCheckForConnection(
  adAccountConnectionId: string,
): Promise<FundAlertCheckResult> {
  const cycle = await db.fundingCycle.findFirst({
    where: { adAccountConnectionId },
    orderBy: { startedAt: "desc" },
    select: { id: true, amount: true, currency: true, startedAt: true },
  });

  if (!cycle) {
    console.log(
      `[fund-alerts] no active funding cycle (Meta-reported spend check skipped) connectionId=${adAccountConnectionId}`,
    );
    return { status: "no_active_cycle" };
  }

  // Account-level rows ONLY — identical identification to the digest builder
  // (src/server/digest.ts): entityType=ACCOUNT, entityId=connection id.
  // Summing multiple entity levels (account + campaign + ad) would
  // double-count, so we sum exactly one level (account).
  //
  // Window: dates >= the cycle's startedAt, up to the latest available data.
  // We deliberately DO NOT exclude the 2 most recent days here. The 2-day
  // exclusion is a fatigue-trend mitigation for stale ctr/frequency/clicks on
  // re-pulls; spend is NOT one of those stale fields, and excluding days would
  // under-report fund spend and delay alerts.
  const rows = await db.insightsDaily.findMany({
    where: {
      entityType: InsightEntity.ACCOUNT,
      entityId: adAccountConnectionId,
      date: { gte: cycle.startedAt },
    },
    select: { spend: true },
  });

  if (rows.length === 0) {
    console.log(
      `[fund-alerts] insufficient data: no account-level rows in-window (Meta-reported) connectionId=${adAccountConnectionId} cycleId=${cycle.id}`,
    );
    return { status: "insufficient_data" };
  }

  const spendToDate = rows.reduce((sum, row) => sum + Number(row.spend), 0);
  const fundAmount = Number(cycle.amount);

  const result = evaluateFundThresholds({ fundAmount, spendToDate });

  console.log(
    `[fund-alerts] evaluated (Meta-reported spend) connectionId=${adAccountConnectionId} cycleId=${cycle.id} currency=${cycle.currency} fundAmount=${result.fundAmount} spendToDate=${result.spendToDate} percentSpent=${result.percentSpent.toFixed(2)} crossedThresholds=[${result.crossedThresholds.join(",")}]`,
  );

  return {
    status: "evaluated",
    cycleId: cycle.id,
    currency: cycle.currency,
    result,
  };
}

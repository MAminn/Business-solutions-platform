import { db } from "@/lib/db";
import { InsightEntity, Prisma } from "@prisma/client";

// ============================================================================
// Fund-threshold evaluation + alert delivery.
//
// A4: pure evaluator (evaluateFundThresholds) + a LOG-ONLY runner
// (runFundAlertCheckForConnection) that sends nothing and writes nothing.
// A5: processFundAlertsForConnection sends ONE email for newly-crossed
// thresholds and persists FundAlertSent dedupe rows ONLY after a successful
// send. The server-only SMTP transport is imported lazily.
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

interface LoadedCycleSpend {
  cycle: { id: string; amount: number; currency: string; startedAt: Date };
  spendToDate: number;
  result: FundThresholdResult;
}

type CycleSpendOutcome =
  | { status: "no_active_cycle" }
  | { status: "insufficient_data"; cycleId: string }
  | ({ status: "ok" } & LoadedCycleSpend);

/**
 * Shared read logic for both the A4 log-only runner and the A5 side-effecting
 * processor, so they cannot diverge. Reads the active funding cycle and sums
 * account-level Meta-reported spend; computes the evaluator result. Writes
 * nothing, logs nothing, sends nothing.
 */
async function loadCycleSpend(
  adAccountConnectionId: string,
): Promise<CycleSpendOutcome> {
  const cycle = await db.fundingCycle.findFirst({
    where: { adAccountConnectionId, cancelledAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, amount: true, currency: true, startedAt: true },
  });

  if (!cycle) return { status: "no_active_cycle" };

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
    return { status: "insufficient_data", cycleId: cycle.id };
  }

  const spendToDate = rows.reduce((sum, row) => sum + Number(row.spend), 0);
  const fundAmount = Number(cycle.amount);
  const result = evaluateFundThresholds({ fundAmount, spendToDate });

  return {
    status: "ok",
    cycle: {
      id: cycle.id,
      amount: fundAmount,
      currency: cycle.currency,
      startedAt: cycle.startedAt,
    },
    spendToDate,
    result,
  };
}

/**
 * Log-only, read-only runner. Behavior preserved exactly: same log lines and
 * same return shape as before; the read is now factored into loadCycleSpend so
 * the A5 processor cannot diverge from it. Writes NOTHING. No email, no
 * FundAlertSent access, no Meta API call, no revalidate.
 */
export async function runFundAlertCheckForConnection(
  adAccountConnectionId: string,
): Promise<FundAlertCheckResult> {
  const loaded = await loadCycleSpend(adAccountConnectionId);

  if (loaded.status === "no_active_cycle") {
    console.log(
      `[fund-alerts] no active funding cycle (Meta-reported spend check skipped) connectionId=${adAccountConnectionId}`,
    );
    return { status: "no_active_cycle" };
  }

  if (loaded.status === "insufficient_data") {
    console.log(
      `[fund-alerts] insufficient data: no account-level rows in-window (Meta-reported) connectionId=${adAccountConnectionId} cycleId=${loaded.cycleId}`,
    );
    return { status: "insufficient_data" };
  }

  const { cycle, result } = loaded;

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

// ============================================================================
// A5 — alert delivery: pure email builder + side-effecting processor.
// ============================================================================

/** Simple currency formatting with a safe fallback; no UI-component dependency. */
function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

/**
 * Pure set subtraction: thresholds crossed now MINUS those already alerted.
 * Returns ascending-sorted newly-crossed thresholds. No I/O.
 */
export function subtractAlreadySent(
  crossedThresholds: number[],
  alreadySent: number[],
): number[] {
  const sent = new Set(alreadySent);
  return crossedThresholds.filter((t) => !sent.has(t)).sort((a, b) => a - b);
}

/**
 * Pure email-body builder. No I/O, no Date.now(). spend/percent are
 * Meta-reported and explicitly labelled as NOT reconciled sales.
 */
export function buildFundAlertEmail(input: {
  accountName: string;
  currency: string;
  fundAmount: number;
  spendToDate: number;
  percentSpent: number;
  newlyCrossed: number[];
}): { subject: string; html: string } {
  const highest =
    input.newlyCrossed.length > 0 ? Math.max(...input.newlyCrossed) : 0;

  const subject = `${input.accountName} — ${highest}% of fund spent (Meta-reported)`;

  const crossedLabel = `${input.newlyCrossed.join("%, ")}%`;
  const fund = formatMoney(input.fundAmount, input.currency);
  const spent = formatMoney(input.spendToDate, input.currency);
  const percent = `${input.percentSpent.toFixed(1)}%`;

  const html = `
<div>
  <h2>Fund spend alert — ${input.accountName}</h2>
  <p>This ad account has crossed the following fund-spend threshold(s): <strong>${crossedLabel}</strong>.</p>
  <ul>
    <li>Account: <strong>${input.accountName}</strong></li>
    <li>Fund amount: <strong>${fund}</strong></li>
    <li>Spend to date (Meta-reported): <strong>${spent}</strong></li>
    <li>Percent spent (Meta-reported): <strong>${percent}</strong></li>
    <li>Thresholds just crossed: <strong>${crossedLabel}</strong></li>
  </ul>
  <p><em>Spend and percent figures are Meta self-reported and are NOT reconciled against real sales. Treat as a pacing signal only.</em></p>
</div>`.trim();

  return { subject, html };
}

type FundAlertProcessResult =
  | { status: "no_active_cycle" }
  | { status: "insufficient_data" }
  | {
      status: "evaluated";
      cycleId: string;
      newlyCrossed: number[];
      alreadySent: number[];
      emailed: boolean;
    };

/**
 * Side-effecting processor (A5). Fail-closed: with no active cycle or no
 * in-window account-level data, sends nothing and writes nothing. Sends one
 * email for newly-crossed thresholds and persists FundAlertSent dedupe rows
 * ONLY after the send succeeds. Never logs SMTP secrets.
 */
export async function processFundAlertsForConnection(
  adAccountConnectionId: string,
): Promise<FundAlertProcessResult> {
  const loaded = await loadCycleSpend(adAccountConnectionId);

  if (loaded.status === "no_active_cycle") {
    console.log(
      `[fund-alerts] no active funding cycle; nothing sent (Meta-reported) connectionId=${adAccountConnectionId}`,
    );
    return { status: "no_active_cycle" };
  }

  if (loaded.status === "insufficient_data") {
    console.log(
      `[fund-alerts] insufficient data; nothing sent (Meta-reported) connectionId=${adAccountConnectionId} cycleId=${loaded.cycleId}`,
    );
    return { status: "insufficient_data" };
  }

  const { cycle, result } = loaded;

  const sentRows = await db.fundAlertSent.findMany({
    where: { fundingCycleId: cycle.id },
    select: { threshold: true },
  });
  const alreadySent = sentRows.map((r) => r.threshold).sort((a, b) => a - b);

  const newlyCrossed = subtractAlreadySent(
    result.crossedThresholds,
    alreadySent,
  );

  if (newlyCrossed.length === 0) {
    console.log(
      `[fund-alerts] no new thresholds to alert (Meta-reported) connectionId=${adAccountConnectionId} cycleId=${cycle.id} crossed=[${result.crossedThresholds.join(",")}] alreadySent=[${alreadySent.join(",")}]`,
    );
    return {
      status: "evaluated",
      cycleId: cycle.id,
      newlyCrossed: [],
      alreadySent,
      emailed: false,
    };
  }

  const recipients = (process.env.FUND_ALERT_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    console.warn(
      `[fund-alerts] FUND_ALERT_TO unset — evaluated but NOT emailed (Meta-reported) connectionId=${adAccountConnectionId} cycleId=${cycle.id} newlyCrossed=[${newlyCrossed.join(",")}]`,
    );
    return {
      status: "evaluated",
      cycleId: cycle.id,
      newlyCrossed,
      alreadySent,
      emailed: false,
    };
  }

  const connection = await db.adAccountConnection.findUnique({
    where: { id: adAccountConnectionId },
    select: { accountName: true },
  });
  const accountName = connection?.accountName ?? adAccountConnectionId;

  const { subject, html } = buildFundAlertEmail({
    accountName,
    currency: cycle.currency,
    fundAmount: result.fundAmount,
    spendToDate: result.spendToDate,
    percentSpent: result.percentSpent,
    newlyCrossed,
  });

  // Lazy import keeps the server-only SMTP transport out of the unit-test
  // module graph; it loads only when an alert is actually being sent.
  const { sendEmail } = await import("@/lib/email");

  try {
    await sendEmail({ to: recipients, subject, html });
  } catch (err) {
    // No FundAlertSent rows are written on failure, so the next run retries.
    console.error(
      `[fund-alerts] email send failed; no dedupe rows written, will retry next run (Meta-reported) connectionId=${adAccountConnectionId} cycleId=${cycle.id} error=${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }

  // Persist dedupe rows ONLY after a successful send. P2002 (unique
  // [fundingCycleId, threshold]) means a concurrent run already recorded it.
  for (const threshold of newlyCrossed) {
    try {
      await db.fundAlertSent.create({
        data: { fundingCycleId: cycle.id, threshold },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Already recorded — idempotent, ignore.
      } else {
        throw err;
      }
    }
  }

  console.log(
    `[fund-alerts] emailed (Meta-reported spend) connectionId=${adAccountConnectionId} cycleId=${cycle.id} newlyCrossed=[${newlyCrossed.join(",")}] recipients=${recipients.length}`,
  );

  return {
    status: "evaluated",
    cycleId: cycle.id,
    newlyCrossed,
    alreadySent,
    emailed: true,
  };
}

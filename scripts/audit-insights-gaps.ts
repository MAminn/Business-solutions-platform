/**
 * audit-insights-gaps.ts
 *
 * READ-ONLY InsightsDaily coverage gap investigation.
 *
 * This script ONLY reports. Specifically:
 *   - ZERO Meta API calls. It never imports or constructs a Meta client and
 *     never touches the network — this is pure database analysis.
 *   - No writes of any kind (no create/update/delete/upsert, no SyncJob rows,
 *     no cleanup). Prisma findMany / groupBy / count / aggregate only.
 *   - No token fields are selected (no accessTokenEnc / refreshTokenEnc /
 *     appSecretEnc), nothing is decrypted, no secret is ever printed.
 *   - No sync function is called (syncStructural / syncInsights* /
 *     fetchInsightsForEntities / runJob / persistInsight).
 *   - Safe to run repeatedly in production. It is account-agnostic: every
 *     AdAccountConnection is iterated, nothing is hardcoded.
 *
 * Usage:
 *   DAYS=90 npx tsx scripts/audit-insights-gaps.ts
 *
 * DAYS is optional and defaults to 90. Non-integer or non-positive values are
 * rejected with an error.
 *
 * Reading the output:
 *   - Retired / PAUSED clients are EXPECTED to show large missing ranges.
 *     That is not a defect — a dormant account simply has no delivery.
 *   - Rule learned during the gap investigation: "A date absent inside a
 *     successfully-requested sync window is a date Meta has no data for
 *     (dormant account), not necessarily a pipeline gap — use
 *     probe-meta-window.ts to confirm against Meta directly."
 *
 * Exit codes:
 *   0 — the audit completed
 *   1 — invalid DAYS, or an unhandled error
 */
import {
  PrismaClient,
  InsightEntity,
  SyncJobType,
  SyncJobStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

function resolveDays(): number {
  const raw = process.env.DAYS?.trim();
  if (!raw) return 90;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.error(
      `ERROR: DAYS must be a positive integer (got "${raw}"). Example: DAYS=90`,
    );
    process.exit(1);
  }
  return parsed;
}

const DAYS = resolveDays();
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const money = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });

function dayList(days: number): string[] {
  const today = new Date(`${iso(new Date())}T00:00:00.000Z`);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--)
    out.push(iso(new Date(today.getTime() - i * DAY)));
  return out;
}

/** Collapse a sorted list of ISO dates into contiguous ranges. */
function ranges(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const out: string[] = [];
  let start = dates[0],
    prev = dates[0];
  for (const d of dates.slice(1)) {
    const gap = (Date.parse(d) - Date.parse(prev)) / DAY;
    if (gap === 1) {
      prev = d;
      continue;
    }
    out.push(start === prev ? start : `${start} → ${prev}`);
    start = d;
    prev = d;
  }
  out.push(start === prev ? start : `${start} → ${prev}`);
  return out;
}

async function main() {
  const days = dayList(DAYS);
  const windowStart = new Date(`${days[0]}T00:00:00.000Z`);
  const windowEnd = new Date(`${days[days.length - 1]}T00:00:00.000Z`);

  const connections = await prisma.adAccountConnection.findMany({
    orderBy: { accountName: "asc" },
    select: {
      id: true,
      accountName: true,
      platformAccountId: true,
      status: true,
      structuralSyncedAt: true,
      insightsBackfilledAt: true,
      lastSyncedAt: true,
      lastSyncError: true,
      client: { select: { name: true, status: true } },
    },
  });

  console.log("=".repeat(96));
  console.log(`INSIGHTSDAILY COVERAGE GAP INVESTIGATION (read-only)`);
  console.log(
    `now=${new Date().toISOString()}  window=${days[0]} → ${days[days.length - 1]} (${DAYS}d)`,
  );
  console.log("=".repeat(96));

  const missingAllByConn = new Map<string, string[]>();

  for (const c of connections) {
    const campaigns = await prisma.campaign.findMany({
      where: { adAccountConnectionId: c.id },
      select: { id: true },
    });
    const campaignIds = campaigns.map((x) => x.id);
    const ads = await prisma.ad.findMany({
      where: { adSet: { campaign: { adAccountConnectionId: c.id } } },
      select: { id: true },
    });
    const adIds = ads.map((x) => x.id);

    // Per-level daily presence + spend.
    const acct = await prisma.insightsDaily.groupBy({
      by: ["date"],
      where: {
        entityType: InsightEntity.ACCOUNT,
        entityId: c.id,
        date: { gte: windowStart, lte: windowEnd },
      },
      _sum: { spend: true },
    });
    const camp = campaignIds.length
      ? await prisma.insightsDaily.groupBy({
          by: ["date"],
          where: {
            entityType: InsightEntity.CAMPAIGN,
            entityId: { in: campaignIds },
            date: { gte: windowStart, lte: windowEnd },
          },
          _sum: { spend: true },
        })
      : [];
    const adl = adIds.length
      ? await prisma.insightsDaily.groupBy({
          by: ["date"],
          where: {
            entityType: InsightEntity.AD,
            entityId: { in: adIds },
            date: { gte: windowStart, lte: windowEnd },
          },
          _sum: { spend: true },
        })
      : [];

    const A = new Map(acct.map((r) => [iso(r.date), num(r._sum.spend)]));
    const C = new Map(camp.map((r) => [iso(r.date), num(r._sum.spend)]));
    const D = new Map(adl.map((r) => [iso(r.date), num(r._sum.spend)]));

    // Independent witness: breakdown rows (only exist where Phase B ran).
    const bd = await prisma.insightsBreakdownDaily.groupBy({
      by: ["date"],
      where: {
        entityType: InsightEntity.ACCOUNT,
        entityId: c.id,
        date: { gte: windowStart, lte: windowEnd },
      },
      _sum: { spend: true },
    });
    const B = new Map(bd.map((r) => [iso(r.date), num(r._sum.spend)]));

    // Does the dataset store zero-spend rows at all? If yes, absence = real gap.
    const zeroSpendRows = await prisma.insightsDaily.count({
      where: { entityType: InsightEntity.ACCOUNT, entityId: c.id, spend: 0 },
    });

    const missingAll: string[] = [];
    const missingAcctOnly: string[] = [];
    let strip = "";
    for (const d of days) {
      const a = A.has(d),
        cc = C.has(d),
        dd = D.has(d);
      if (!a && !cc && !dd) {
        missingAll.push(d);
        strip += ".";
      } else if (!a && cc) {
        missingAcctOnly.push(d);
        strip += "a";
      } else if (a && !cc) {
        strip += "c";
      } else strip += "#";
    }
    missingAllByConn.set(c.accountName, missingAll);

    // Affected spend: proven (breakdown witness) vs estimated (neighbour avg).
    const provenSpend = missingAll.reduce((s, d) => s + (B.get(d) ?? 0), 0);
    const presentSpends = days.filter((d) => C.has(d)).map((d) => C.get(d)!);
    const avgPresent = presentSpends.length
      ? presentSpends.reduce((a, b) => a + b, 0) / presentSpends.length
      : 0;

    console.log("");
    console.log("-".repeat(96));
    console.log(
      `• ${c.accountName} (${c.platformAccountId})  conn=${c.status}  client=${c.client?.name ?? "?"}/${c.client?.status ?? "?"}`,
    );
    console.log(
      `    insightsBackfilledAt: ${c.insightsBackfilledAt?.toISOString() ?? "NULL"}`,
    );
    console.log(
      `    lastSyncedAt:         ${c.lastSyncedAt?.toISOString() ?? "null"}`,
    );
    console.log(`    lastSyncError:        ${c.lastSyncError ?? "none"}`);
    console.log(
      `    zero-spend ACCOUNT rows stored: ${zeroSpendRows}` +
        `  ${
          zeroSpendRows > 0
            ? "(zero-spend days ARE stored → absence = real gap)"
            : "(no zero-spend rows → absence may mean no spend)"
        }`,
    );
    console.log(
      `    coverage strip (oldest→newest): # all levels | a ACCOUNT missing | c CAMPAIGN missing | . none`,
    );
    console.log(`      ${strip}`);
    console.log(
      `    days present: ACCOUNT=${A.size}/${DAYS}  CAMPAIGN=${C.size}/${DAYS}  AD=${D.size}/${DAYS}  BREAKDOWN=${B.size}`,
    );
    console.log(
      `    MISSING at all levels (${missingAll.length}d): ${ranges(missingAll).join(", ") || "none"}`,
    );
    if (missingAcctOnly.length)
      console.log(
        `    ACCOUNT-only missing (${missingAcctOnly.length}d): ${ranges(missingAcctOnly).join(", ")}`,
      );
    if (provenSpend > 0)
      console.log(
        `    PROVEN unrecorded spend on missing days (breakdown witness): ${money(provenSpend)}`,
      );
    else if (missingAll.length > 0)
      console.log(
        `    ESTIMATED unrecorded spend (avg present day ${money(avgPresent)} × ${missingAll.length}d): ~${money(avgPresent * missingAll.length)}  [ESTIMATE ONLY]`,
      );

    // ---- SyncJob history -------------------------------------------------
    const jobs = await prisma.syncJob.findMany({
      where: { adAccountConnectionId: c.id, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "asc" },
      select: {
        type: true,
        status: true,
        recordsSynced: true,
        errorMessage: true,
        createdAt: true,
      },
    });
    const perDay = new Map<string, { ok: number; fail: number }>();
    for (const j of jobs) {
      const k = iso(j.createdAt);
      const e = perDay.get(k) ?? { ok: 0, fail: 0 };
      if (j.status === SyncJobStatus.FAILED) e.fail++;
      else e.ok++;
      perDay.set(k, e);
    }
    const daysNoJobs = days.filter((d) => !perDay.has(d));
    const failed = jobs.filter((j) => j.status === SyncJobStatus.FAILED);
    const lastBackfill = [...jobs]
      .reverse()
      .find(
        (j) =>
          j.type === SyncJobType.INSIGHTS_BACKFILL &&
          j.status === SyncJobStatus.SUCCESS,
      );

    console.log(
      `    SyncJob rows in window: ${jobs.length}   FAILED: ${failed.length}`,
    );
    console.log(
      `    days with NO SyncJob at all (${daysNoJobs.length}d): ${ranges(daysNoJobs).join(", ") || "none"}`,
    );
    console.log(
      `    last SUCCESSFUL INSIGHTS_BACKFILL: ${lastBackfill ? lastBackfill.createdAt.toISOString() : "none in window"}`,
    );
    for (const f of failed.slice(-8))
      console.log(
        `      FAILED ${iso(f.createdAt)} ${f.type}: ${(f.errorMessage ?? "").slice(0, 140)}`,
      );
  }

  // ---- Cross-client overlap -------------------------------------------------
  console.log("");
  console.log("=".repeat(96));
  console.log("CROSS-CLIENT OVERLAP OF MISSING DAYS");
  const names = [...missingAllByConn.keys()];
  const sets = names.map((n) => new Set(missingAllByConn.get(n)!));
  const shared = days.filter(
    (d) => sets.length > 0 && sets.every((s) => s.has(d)),
  );
  for (const n of names)
    console.log(
      `  ${n.padEnd(22)} missing ${missingAllByConn.get(n)!.length}d`,
    );
  console.log(
    `  MISSING FOR EVERY CONNECTION (${shared.length}d): ${ranges(shared).join(", ") || "none"}`,
  );
  const anyTwo = days.filter((d) => sets.filter((s) => s.has(d)).length >= 2);
  console.log(
    `  MISSING FOR ≥2 CONNECTIONS (${anyTwo.length}d): ${ranges(anyTwo).join(", ") || "none"}`,
  );
  console.log("=".repeat(96));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

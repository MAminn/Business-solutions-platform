/**
 * probe-meta-window.ts
 *
 * Asks Meta directly what delivery data exists for ONE ad account over ONE
 * date window. This is the companion to audit-insights-gaps.ts: that script
 * NEVER contacts Meta (pure database analysis), while this one makes READ-ONLY
 * Meta GET calls — that is its entire purpose. Use it to confirm whether a
 * date missing from InsightsDaily is a real pipeline gap or simply a day Meta
 * has no data for.
 *
 * This script ONLY reports. Specifically:
 *   - ZERO database writes (no create/update/delete/upsert, no cleanup).
 *     The only database access is a single read to resolve the connection.
 *   - It never calls any sync function (syncStructural / syncInsights* /
 *     fetchInsightsForEntities / runJob), never calls persistInsight, and
 *     never creates SyncJob rows.
 *   - It reuses the EXISTING client construction path (getMetaClient) and the
 *     EXISTING client read methods (getInsightsDaily,
 *     getAccountInsightsByLevel). It never reimplements auth or token
 *     handling, never decrypts anything itself.
 *   - It never logs or prints token material or any secret.
 *
 * Usage:
 *   ACCOUNT_ID=act_xxx SINCE=2026-06-01 UNTIL=2026-06-20 npx tsx scripts/probe-meta-window.ts
 *
 * All three variables are required. Dates are yyyy-MM-dd.
 *
 * NOTE: this consumes Meta API quota and counts against the account's rate
 * limit. Use it sparingly, on a specific narrow window under investigation,
 * rather than broadly or on a schedule.
 *
 * Exit codes:
 *   0 — the probe completed
 *   1 — missing env vars, connection not resolvable, or an unhandled error
 */
import { db } from "@/lib/db";
import { getMetaClient } from "@/lib/meta/sync";

async function main() {
  const accountId = process.env.ACCOUNT_ID?.trim();
  const since = process.env.SINCE?.trim();
  const until = process.env.UNTIL?.trim();

  if (!accountId || !since || !until) {
    console.error("ERROR: ACCOUNT_ID, SINCE, UNTIL required (yyyy-MM-dd).");
    process.exit(1);
  }

  const conn = await db.adAccountConnection.findFirst({
    where: { platformAccountId: accountId },
    select: { id: true, accountName: true },
  });

  if (!conn) {
    console.error("Connection not found.");
    process.exit(1);
  }

  const ctx = await getMetaClient(conn.id);

  if (!ctx) {
    console.error("Could not build Meta client.");
    process.exit(1);
  }

  console.log(`Probing ${conn.accountName} ${since} → ${until} (READ-ONLY)\n`);

  const acct = await ctx.meta.getInsightsDaily(
    ctx.platformAccountId,
    since,
    until,
  );

  console.log(`ACCOUNT-level rows returned by Meta: ${acct.length}`);
  for (const r of acct) {
    console.log(
      `  ${r.date_start}  spend=${r.spend ?? "0"}  impressions=${r.impressions ?? "0"}`,
    );
  }

  const camp = await ctx.meta.getAccountInsightsByLevel(
    ctx.platformAccountId,
    "campaign",
    since,
    until,
  );

  const byDate = new Map<string, number>();

  for (const r of camp) {
    const d = r.date_start ?? "?";
    byDate.set(d, (byDate.get(d) ?? 0) + Number(r.spend ?? 0));
  }

  console.log(
    `\nCAMPAIGN-level rows: ${camp.length}, distinct dates: ${byDate.size}`,
  );
  for (const d of [...byDate.keys()].sort()) {
    console.log(`  ${d}  spend=${byDate.get(d)!.toFixed(2)}`);
  }

  console.log("\nDates absent above = Meta has no delivery data for them.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());

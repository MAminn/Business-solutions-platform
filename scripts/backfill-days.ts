/**
 * backfill-days.ts
 *
 * One-off insights coverage top-up. Calls the existing exported
 * syncInsightsBackfill(connectionId, days) from src/lib/meta/sync.ts
 * without modifying it. Use after the monthly digest/bundle reports
 * missing coverage dates.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-days.ts --connection <id> --days <n>
 *
 * Requires the same environment as the app (DATABASE_URL, token encryption
 * key, etc.) since it decrypts the connection token and writes InsightsDaily
 * rows through the normal sync job path (a SyncJob row is recorded).
 */
import { syncInsightsBackfill } from "../src/lib/meta/sync";

function parseArgs(argv: string[]): { connection: string; days: number } {
  let connection: string | undefined;
  let days: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--connection") {
      connection = argv[++i];
    } else if (argv[i] === "--days") {
      days = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  if (!connection || connection.trim() === "") {
    throw new Error("Missing required --connection <id>");
  }
  if (days === undefined || !Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Missing or invalid --days <n> (integer 1-365)");
  }

  return { connection: connection.trim(), days };
}

async function main(): Promise<void> {
  const { connection, days } = parseArgs(process.argv.slice(2));
  console.log(
    `Backfilling ${days} day(s) of insights for connection ${connection}…`,
  );
  await syncInsightsBackfill(connection, days);
  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

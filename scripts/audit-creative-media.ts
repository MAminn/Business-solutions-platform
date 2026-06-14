/**
 * audit-creative-media.ts
 *
 * READ-ONLY production-safe diagnostic. Reports the MEDIA COVERAGE of the
 * Creative table for a connection (or all ACTIVE connections): how many
 * creatives have a full-res image, only a low-res thumbnail, or nothing at
 * all, and how many can deep-link to a real published post vs. falling back
 * to Ads Manager.
 *
 * It NEVER modifies anything: no writes, no schema changes, no sync functions,
 * no Meta/Graph API calls, no token decryption. It uses Prisma read operations
 * only (findFirst/findMany/count) and is safe to run repeatedly with identical
 * output and no side effects.
 *
 * Usage:
 *   # one connection by its DB id
 *   CONNECTION_ID="ck...." tsx scripts/audit-creative-media.ts
 *
 *   # one connection by Meta platformAccountId
 *   ACCOUNT_ID="act_2106505896497404" tsx scripts/audit-creative-media.ts
 *
 *   # every ACTIVE connection
 *   tsx scripts/audit-creative-media.ts
 *
 * Exit codes:
 *   0 — script ran successfully
 *   1 — requested connection not found, or the script errored
 */
import { PrismaClient, ConnectionStatus, CreativeType } from "@prisma/client";

const prisma = new PrismaClient();

function heading(title: string): void {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

interface MediaCoverage {
  total: number;
  withImageUrl: number; // non-null imageUrl (full-res render)
  thumbnailOnly: number; // imageUrl null, thumbnailUrl non-null (low-res fallback)
  bothNull: number; // imageUrl null and thumbnailUrl null (gradient placeholder)
  withStoryId: number; // (effective)objectStoryId present -> Preview-in-Meta post
  withoutStoryId: number; // neither -> Preview falls back to Ads Manager
  video: number; // CreativeType.VIDEO count
  videoThumbnailOnly: number; // VIDEO with imageUrl null but thumbnailUrl non-null
}

async function coverageForConnection(
  connectionId: string,
): Promise<MediaCoverage> {
  const where = { adAccountConnectionId: connectionId };

  const [
    total,
    withImageUrl,
    thumbnailOnly,
    bothNull,
    withStoryId,
    video,
    videoThumbnailOnly,
  ] = await Promise.all([
    prisma.creative.count({ where }),
    prisma.creative.count({ where: { ...where, imageUrl: { not: null } } }),
    prisma.creative.count({
      where: { ...where, imageUrl: null, thumbnailUrl: { not: null } },
    }),
    prisma.creative.count({
      where: { ...where, imageUrl: null, thumbnailUrl: null },
    }),
    prisma.creative.count({
      where: {
        ...where,
        OR: [
          { effectiveObjectStoryId: { not: null } },
          { objectStoryId: { not: null } },
        ],
      },
    }),
    prisma.creative.count({ where: { ...where, type: CreativeType.VIDEO } }),
    prisma.creative.count({
      where: {
        ...where,
        type: CreativeType.VIDEO,
        imageUrl: null,
        thumbnailUrl: { not: null },
      },
    }),
  ]);

  return {
    total,
    withImageUrl,
    thumbnailOnly,
    bothNull,
    withStoryId,
    withoutStoryId: total - withStoryId,
    video,
    videoThumbnailOnly,
  };
}

function printCoverage(label: string, c: MediaCoverage): void {
  const rows: Array<[string, number]> = [
    ["total creatives", c.total],
    ["  with imageUrl (full-res)", c.withImageUrl],
    ["  thumbnail-only (low-res fallback)", c.thumbnailOnly],
    ["  both null (gradient placeholder)", c.bothNull],
    ["  with story id (Preview-in-Meta post)", c.withStoryId],
    ["  no story id (Ads Manager fallback)", c.withoutStoryId],
    ["  VIDEO type", c.video],
    ["    VIDEO thumbnail-only (no full-res)", c.videoThumbnailOnly],
  ];

  console.log("");
  console.log(label);
  const labelWidth = Math.max(...rows.map(([name]) => name.length));
  for (const [name, value] of rows) {
    console.log(`  ${name.padEnd(labelWidth)}  ${String(value).padStart(7)}`);
  }
}

function addCoverage(a: MediaCoverage, b: MediaCoverage): MediaCoverage {
  return {
    total: a.total + b.total,
    withImageUrl: a.withImageUrl + b.withImageUrl,
    thumbnailOnly: a.thumbnailOnly + b.thumbnailOnly,
    bothNull: a.bothNull + b.bothNull,
    withStoryId: a.withStoryId + b.withStoryId,
    withoutStoryId: a.withoutStoryId + b.withoutStoryId,
    video: a.video + b.video,
    videoThumbnailOnly: a.videoThumbnailOnly + b.videoThumbnailOnly,
  };
}

async function main(): Promise<void> {
  const connectionId = process.env.CONNECTION_ID?.trim();
  const accountId = process.env.ACCOUNT_ID?.trim();

  let connections: Array<{
    id: string;
    accountName: string;
    platformAccountId: string;
    status: ConnectionStatus;
  }>;

  if (connectionId || accountId) {
    const connection = await prisma.adAccountConnection.findFirst({
      where: connectionId
        ? { id: connectionId }
        : { platformAccountId: accountId },
      select: {
        id: true,
        accountName: true,
        platformAccountId: true,
        status: true,
      },
    });
    if (!connection) {
      console.error(
        `ERROR: No AdAccountConnection found for ${
          connectionId
            ? `CONNECTION_ID = "${connectionId}"`
            : `ACCOUNT_ID = "${accountId}"`
        }.`,
      );
      process.exit(1);
    }
    connections = [connection];
  } else {
    connections = await prisma.adAccountConnection.findMany({
      where: { status: ConnectionStatus.ACTIVE },
      orderBy: { accountName: "asc" },
      select: {
        id: true,
        accountName: true,
        platformAccountId: true,
        status: true,
      },
    });
    if (connections.length === 0) {
      console.error("ERROR: No ACTIVE AdAccountConnection rows found.");
      process.exit(1);
    }
  }

  heading("CREATIVE MEDIA COVERAGE (read-only)");
  console.log(`Connections audited: ${connections.length}`);

  let totals: MediaCoverage = {
    total: 0,
    withImageUrl: 0,
    thumbnailOnly: 0,
    bothNull: 0,
    withStoryId: 0,
    withoutStoryId: 0,
    video: 0,
    videoThumbnailOnly: 0,
  };

  for (const connection of connections) {
    const coverage = await coverageForConnection(connection.id);
    totals = addCoverage(totals, coverage);
    printCoverage(
      `${connection.accountName} (${connection.platformAccountId} · ${connection.status} · ${connection.id})`,
      coverage,
    );
  }

  if (connections.length > 1) {
    heading("TOTALS (all audited connections)");
    printCoverage("ALL CONNECTIONS", totals);
  }

  console.log("");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

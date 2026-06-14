/**
 * probe-creative-source-fields.ts
 *
 * READ-ONLY diagnostic probe. For a given connection (or every ACTIVE
 * connection when explicitly opted in), it makes a SINGLE paginated
 * account-level read of `/act_{id}/ads` requesting the nested creative source
 * fields and prints how many distinct creatives carry each field non-null.
 *
 * Its only purpose is to confirm whether accounts that today have no story id
 * (e.g. Mach, Perce) expose any other recoverable source identifier
 * (object_story_spec, source_instagram_media_id, video_id, image_hash) before
 * scoping a v3 backfill. It writes nothing.
 *
 * What it does NOT do: no DB writes, no schema changes, no sync functions, no
 * dedupe, no bundle/report changes. It performs Graph API READS only and
 * decrypts the connection token solely to authorize those reads.
 *
 * GATING: this never runs automatically. You must pass an explicit target:
 *   CONNECTION_ID="ck...."  tsx scripts/probe-creative-source-fields.ts
 *   ACCOUNT_ID="act_2106505896497404" tsx scripts/probe-creative-source-fields.ts
 *   ALL=1 tsx scripts/probe-creative-source-fields.ts   # every ACTIVE connection
 *
 * Requires the same environment as the app (DATABASE_URL, TOKEN_ENCRYPTION_KEY).
 *
 * Exit codes:
 *   0 — probe ran successfully
 *   1 — no explicit target given, target not found, or the probe errored
 */
import { PrismaClient, ConnectionStatus } from "@prisma/client";
import { decryptToken } from "../src/lib/encryption";
import { META_GRAPH_URL } from "../src/lib/meta/oauth";

const prisma = new PrismaClient();

// Exactly the nested creative source fields we want to inspect for recoverability.
const CREATIVE_FIELDS =
  "object_story_id,effective_object_story_id,object_story_spec,source_instagram_media_id,video_id,image_hash";
const ADS_FIELDS = `id,creative{id,${CREATIVE_FIELDS}}`;

interface ProbeCreative {
  id?: string;
  object_story_id?: string | null;
  effective_object_story_id?: string | null;
  object_story_spec?: unknown;
  source_instagram_media_id?: string | null;
  video_id?: string | null;
  image_hash?: string | null;
}

interface ProbeAd {
  id: string;
  creative?: ProbeCreative | null;
}

interface FieldCounts {
  distinctCreatives: number;
  objectStoryId: number;
  effectiveObjectStoryId: number;
  anyStoryId: number; // object_story_id OR effective_object_story_id
  objectStorySpec: number;
  sourceInstagramMediaId: number;
  videoId: number;
  imageHash: number;
  // Distinct creatives with NO story id but SOME other recoverable identifier.
  noStoryButRecoverable: number;
  // Distinct creatives with no story id and no other identifier at all.
  noStoryNoRecoverable: number;
}

function heading(title: string): void {
  console.log("");
  console.log("=".repeat(72));
  console.log(title);
  console.log("=".repeat(72));
}

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

// Single paginated account-level read of /act_{id}/ads. Follows Meta's
// `paging.next` cursors until exhausted, with a guard against a runaway cursor.
async function readAccountAds(
  accountId: string,
  accessToken: string,
): Promise<ProbeAd[]> {
  const rows: ProbeAd[] = [];

  const first = new URL(`${META_GRAPH_URL}/${accountId}/ads`);
  first.searchParams.set("access_token", accessToken);
  first.searchParams.set("fields", ADS_FIELDS);
  first.searchParams.set("limit", "500");

  let next: string | undefined = first.toString();
  let guard = 0;
  while (next && guard < 1000) {
    // Gentle inter-call spacing to avoid burst pressure (mirrors the client).
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    const res = await fetch(next, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Meta API ${res.status} on /${accountId}/ads: ${body.slice(0, 500)}`,
      );
    }
    const page = (await res.json()) as {
      data?: ProbeAd[];
      paging?: { next?: string };
    };
    rows.push(...(page.data ?? []));
    next = page.paging?.next;
    guard++;
  }

  return rows;
}

function countFields(ads: ProbeAd[]): FieldCounts {
  // Dedupe by creative id so shared creatives are counted once.
  const seen = new Map<string, ProbeCreative>();
  for (const ad of ads) {
    const c = ad.creative;
    if (!c) continue;
    const key = c.id ?? `ad:${ad.id}`;
    if (!seen.has(key)) seen.set(key, c);
  }

  const counts: FieldCounts = {
    distinctCreatives: seen.size,
    objectStoryId: 0,
    effectiveObjectStoryId: 0,
    anyStoryId: 0,
    objectStorySpec: 0,
    sourceInstagramMediaId: 0,
    videoId: 0,
    imageHash: 0,
    noStoryButRecoverable: 0,
    noStoryNoRecoverable: 0,
  };

  for (const c of seen.values()) {
    const hasObjectStoryId = present(c.object_story_id);
    const hasEffectiveStoryId = present(c.effective_object_story_id);
    const hasAnyStory = hasObjectStoryId || hasEffectiveStoryId;
    const hasSpec = present(c.object_story_spec);
    const hasIgMedia = present(c.source_instagram_media_id);
    const hasVideo = present(c.video_id);
    const hasImageHash = present(c.image_hash);

    if (hasObjectStoryId) counts.objectStoryId++;
    if (hasEffectiveStoryId) counts.effectiveObjectStoryId++;
    if (hasAnyStory) counts.anyStoryId++;
    if (hasSpec) counts.objectStorySpec++;
    if (hasIgMedia) counts.sourceInstagramMediaId++;
    if (hasVideo) counts.videoId++;
    if (hasImageHash) counts.imageHash++;

    if (!hasAnyStory) {
      const recoverable = hasSpec || hasIgMedia || hasVideo || hasImageHash;
      if (recoverable) counts.noStoryButRecoverable++;
      else counts.noStoryNoRecoverable++;
    }
  }

  return counts;
}

function printCounts(label: string, c: FieldCounts): void {
  const rows: Array<[string, number]> = [
    ["distinct creatives", c.distinctCreatives],
    ["  object_story_id", c.objectStoryId],
    ["  effective_object_story_id", c.effectiveObjectStoryId],
    ["  any story id", c.anyStoryId],
    ["  object_story_spec", c.objectStorySpec],
    ["  source_instagram_media_id", c.sourceInstagramMediaId],
    ["  video_id", c.videoId],
    ["  image_hash", c.imageHash],
    [
      "  no story id BUT recoverable (spec/ig/video/hash)",
      c.noStoryButRecoverable,
    ],
    ["  no story id and nothing recoverable", c.noStoryNoRecoverable],
  ];

  console.log("");
  console.log(label);
  const labelWidth = Math.max(...rows.map(([name]) => name.length));
  for (const [name, value] of rows) {
    console.log(`  ${name.padEnd(labelWidth)}  ${String(value).padStart(7)}`);
  }
}

async function main(): Promise<void> {
  const connectionId = process.env.CONNECTION_ID?.trim();
  const accountId = process.env.ACCOUNT_ID?.trim();
  const all = process.env.ALL?.trim() === "1";

  if (!connectionId && !accountId && !all) {
    console.error(
      "ERROR: This probe makes live Meta reads and must be gated explicitly.\n" +
        "Pass one of:\n" +
        '  CONNECTION_ID="ck...."  tsx scripts/probe-creative-source-fields.ts\n' +
        '  ACCOUNT_ID="act_123..."  tsx scripts/probe-creative-source-fields.ts\n' +
        "  ALL=1                    tsx scripts/probe-creative-source-fields.ts",
    );
    process.exit(1);
  }

  let connections: Array<{
    id: string;
    accountName: string;
    platformAccountId: string;
    status: ConnectionStatus;
    accessTokenEnc: string | null;
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
        accessTokenEnc: true,
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
        accessTokenEnc: true,
      },
    });
    if (connections.length === 0) {
      console.error("ERROR: No ACTIVE AdAccountConnection rows found.");
      process.exit(1);
    }
  }

  heading("CREATIVE SOURCE-FIELD PROBE (read-only Meta reads)");
  console.log(`Connections probed: ${connections.length}`);

  for (const connection of connections) {
    const label = `${connection.accountName} (${connection.platformAccountId} · ${connection.status} · ${connection.id})`;
    if (!connection.accessTokenEnc) {
      console.log("");
      console.log(`${label}\n  SKIPPED: no OAuth token on this connection.`);
      continue;
    }

    let token: string;
    try {
      token = decryptToken(connection.accessTokenEnc);
    } catch {
      console.log("");
      console.log(`${label}\n  SKIPPED: token could not be decrypted.`);
      continue;
    }

    try {
      const ads = await readAccountAds(connection.platformAccountId, token);
      const counts = countFields(ads);
      printCounts(label, counts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("");
      console.log(`${label}\n  ERROR: ${message}`);
    }
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

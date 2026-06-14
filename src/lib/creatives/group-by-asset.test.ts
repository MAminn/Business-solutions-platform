import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creativeAssetKey,
  groupCreativesByAsset,
  type CreativeAssetKeyFields,
} from "./group-by-asset";

// Fixture: known duplicate groups (shared effectiveObjectStoryId, shared
// videoId, shared imageHash, shared normalized imageUrl) plus unique rows.
const rows: CreativeAssetKeyFields[] = [
  // Group A — shared effectiveObjectStoryId.
  { id: "c1", effectiveObjectStoryId: "p_100" },
  { id: "c2", effectiveObjectStoryId: "p_100" },
  // Group B — shared videoId (no story ids).
  { id: "c3", videoId: "v_9" },
  { id: "c4", videoId: "v_9" },
  // Group C — shared imageHash (no story/video).
  { id: "c5", imageHash: "h_abc" },
  { id: "c6", imageHash: "h_abc" },
  // Group D — same image, different CDN signing query strings.
  { id: "c7", imageUrl: "https://cdn.example.com/a.jpg?sig=1" },
  { id: "c8", imageUrl: "https://cdn.example.com/a.jpg?sig=2" },
  // Unique rows — fall back to id.
  { id: "c9" },
  { id: "c10" },
];

const EXPECTED_UNIQUE_ASSETS = 6; // A, B, C, D, c9, c10

test("groups equal the expected unique-asset count", () => {
  const groups = groupCreativesByAsset(rows);
  assert.equal(groups.length, EXPECTED_UNIQUE_ASSETS);
});

test("a known duplicate group collapses to exactly one group with all members", () => {
  const groups = groupCreativesByAsset(rows);

  const storyGroups = groups.filter((g) =>
    g.some((r) => r.id === "c1" || r.id === "c2"),
  );
  assert.equal(storyGroups.length, 1, "c1/c2 must share a single group");

  const storyGroup = storyGroups[0]!;
  const ids = storyGroup.map((r) => r.id).sort();
  assert.deepEqual(ids, ["c1", "c2"]);
});

test("shared videoId and imageHash rows each collapse to one group", () => {
  const groups = groupCreativesByAsset(rows);

  const videoGroup = groups.find((g) => g.some((r) => r.id === "c3"))!;
  assert.deepEqual(videoGroup.map((r) => r.id).sort(), ["c3", "c4"]);

  const hashGroup = groups.find((g) => g.some((r) => r.id === "c5"))!;
  assert.deepEqual(hashGroup.map((r) => r.id).sort(), ["c5", "c6"]);
});

test("unique rows stay as singleton groups", () => {
  const groups = groupCreativesByAsset(rows);
  const c9 = groups.find((g) => g.some((r) => r.id === "c9"))!;
  const c10 = groups.find((g) => g.some((r) => r.id === "c10"))!;
  assert.equal(c9.length, 1);
  assert.equal(c10.length, 1);
});

test("key chain precedence prefers effectiveObjectStoryId over later keys", () => {
  const key = creativeAssetKey({
    id: "x",
    effectiveObjectStoryId: "p_1",
    objectStoryId: "p_2",
    videoId: "v_1",
    imageHash: "h_1",
    imageUrl: "https://cdn.example.com/x.jpg",
  });
  assert.equal(key, "p_1");
});

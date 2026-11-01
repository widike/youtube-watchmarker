import test from "node:test";
import assert from "node:assert/strict";
import { normalizeVideo } from "./history-records.js";
import { summarizeHistory } from "./history-statistics.js";
import {
  likedVideo,
  likedPage,
  setupLikedSync,
} from "./test-support/youtube-liked.js";

test("likes skip known videos by ID even when their title changed", async (t) => {
  const existing = normalizeVideo({
    strIdent: "aaaaaaaaaaa",
    strTitle: "Saved title",
    intTimestamp: 2000,
    intImportedCount: 0,
    watchEvents: [1000, 2000].map((watchedAt) => ({
      eventId: `play:${watchedAt}`,
      watchedAt,
      source: "playback",
      precision: "exact",
    })),
  });
  const { manager, records, writes } = setupLikedSync(
    t,
    likedPage([likedVideo(existing.strIdent, "Changed liked title")]),
    {},
    [existing],
  );
  for (let i = 0; i < 2; i++) {
    const result = await manager.synchronizeLikedVideos();
    assert.equal(result.skippedCount, 1);
    assert.equal(result.newCount, 0);
    assert.equal(result.updatedCount, 0);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(records.get(existing.strIdent), existing);
});

test("a new liked video is imported once without a watch date or period activity", async (t) => {
  const { manager, records, writes } = setupLikedSync(
    t,
    likedPage([likedVideo("aaaaaaaaaaa"), likedVideo("aaaaaaaaaaa")]),
  );
  assert.equal((await manager.synchronizeLikedVideos()).newCount, 1);
  const imported = records.get("aaaaaaaaaaa");
  assert.equal(imported.intTimestamp, 0);
  assert.equal(imported.intCount, 1);
  assert.deepEqual(imported.watchEvents, []);
  assert.equal((await manager.synchronizeLikedVideos()).skippedCount, 1);
  assert.equal(writes.length, 1);
  assert.equal(records.size, 1);
  const stats = summarizeHistory([...records.values()], { period: "all" });
  assert.equal(stats.selected, 0);
  assert.equal(stats.unique, 0);
});

test("a liked import cannot restore an explicitly deleted video", async (t) => {
  const deleted = normalizeVideo({
    strIdent: "aaaaaaaaaaa",
    strTitle: "Deleted from my library",
    intTimestamp: 1000,
    intDeletedAt: 2000,
    intCount: 1,
  });
  const { manager, records, writes } = setupLikedSync(
    t,
    likedPage([likedVideo(deleted.strIdent)]),
    {},
    [deleted],
  );
  assert.equal((await manager.synchronizeLikedVideos()).skippedCount, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(records.get(deleted.strIdent), deleted);
});

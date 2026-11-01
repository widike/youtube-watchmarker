import test from "node:test";
import assert from "node:assert/strict";
import { reconcileImportedVideo } from "./history-reconciliation.js";
import { mergeVideo, normalizeVideo } from "./history-records.js";
import { countedEvents, historyEntries } from "./history-events.js";
import { IMPORT_CORRECTION } from "./history-import-corrections.js";

const now = new Date(2026, 10, 1, 20).getTime();
const midnight = new Date(2026, 10, 1).getTime();
const saved = (at, extra = {}) => ({
  strIdent: "abcdefghijk",
  strTitle: "Original title",
  intTimestamp: at,
  intCount: 1,
  ...extra,
});
const play = (id, watchedAt = now) => ({
  eventId: id,
  watchedAt,
  source: "playback",
  precision: "exact",
});
const tracked = (events) =>
  normalizeVideo({ ...saved(now), intImportedCount: 0, watchEvents: events });

test("historical import overlap is repaired without deleting evidence or inventing undated watches", () => {
  const original = mergeVideo(saved(midnight), saved(now - 1000));
  const { video, removed } = reconcileImportedVideo(original, now);
  assert.equal(removed, 1);
  assert.equal(video.intCount, 1);
  assert.equal(video.intUnknownCount, 0);
  assert.equal(video.intImportedCount, original.intImportedCount);
  assert.equal(video.intTimestamp, original.intTimestamp);
  assert.equal(video.strTitle, original.strTitle);
  assert.equal(historyEntries([video]).length, 1);
  for (const event of original.watchEvents)
    assert.deepEqual(
      video.watchEvents.find((row) => row.eventId === event.eventId),
      event,
    );
  assert.equal(
    video.watchEvents.filter((event) => event.source === "receipt").length,
    1,
  );
  assert.deepEqual(reconcileImportedVideo(video, now), { video, removed: 0 });
});

test("all source overlaps yield to real sessions, including simultaneous replays", () => {
  const imported = mergeVideo(saved(midnight), saved(now - 1000));
  const original = mergeVideo(
    imported,
    tracked([play("first"), play("second")]),
  );
  const { video, removed } = reconcileImportedVideo(original, now);
  assert.equal(removed, 2);
  assert.equal(video.intCount, 2);
  assert.equal(video.intUnknownCount, 0);
  assert.deepEqual(
    countedEvents(video.watchEvents),
    countedEvents(original.watchEvents).filter(
      (event) => event.source === "playback",
    ),
  );
});

test("stale devices and repeated backups cannot resurrect reconciled imports", () => {
  const stale = mergeVideo(saved(midnight), saved(now - 1000));
  const repaired = reconcileImportedVideo(stale, now).video;
  assert.deepEqual(mergeVideo(repaired, stale), repaired);
  assert.deepEqual(mergeVideo(stale, repaired), repaired);
  assert.deepEqual(
    normalizeVideo(JSON.parse(JSON.stringify(repaired))),
    repaired,
  );
});

test("counter-only history remains undated and is never guessed away", () => {
  const original = mergeVideo(
    saved(midnight, { intCount: 8 }),
    saved(now - 1000),
  );
  const { video } = reconcileImportedVideo(original, now);
  assert.equal(video.intUnknownCount, original.intUnknownCount);
  assert.equal(video.intCount, original.intCount - 1);
  assert.equal(
    historyEntries([video]).find((entry) => entry.unknownViews).unknownViews,
    6,
  );
});

test("distinct local days, deleted records and future evidence are preserved", () => {
  const yesterday = new Date(2026, 9, 31, 12).getTime();
  assert.equal(
    reconcileImportedVideo(mergeVideo(saved(yesterday), saved(now)), now)
      .removed,
    0,
  );
  const duplicates = mergeVideo(saved(midnight), saved(now - 1000));
  const deleted = { ...duplicates, intDeletedAt: now + 1 };
  assert.deepEqual(reconcileImportedVideo(deleted, now), {
    video: normalizeVideo(deleted),
    removed: 0,
  });
  assert.equal(
    reconcileImportedVideo(mergeVideo(saved(now), saved(now + 1)), now).removed,
    0,
  );
});

test("correction receipts cannot suppress a playback identity", () => {
  const original = tracked([play("first")]);
  const video = normalizeVideo({
    ...original,
    watchEvents: [
      ...original.watchEvents,
      {
        eventId: `${IMPORT_CORRECTION}first`,
        watchedAt: 0,
        source: "receipt",
        precision: "inferred",
      },
    ],
  });
  assert.equal(video.intCount, 1);
  assert.equal(historyEntries([video]).length, 1);
});

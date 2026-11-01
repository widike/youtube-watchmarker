import test from "node:test";
import assert from "node:assert/strict";
import { mergeVideo, normalizeVideo } from "./history-records.js";
import { historyEntries } from "./history-events.js";
import { queryHistory } from "./history-query.js";
import { describeWatchDate } from "./ui/date-utils.js";
import { historyRows, videoCard } from "./ui/history-library.js";

const id = "abcdefghijk";
const playback = (eventId, watchedAt, observedDeletion = 0) => ({
  eventId,
  watchedAt,
  source: "playback",
  precision: "exact",
  observedDeletion,
});
const video = (events, extra = {}) =>
  normalizeVideo({
    strIdent: id,
    strTitle: "A video",
    intTimestamp: Math.max(...events.map((e) => e.watchedAt)),
    intImportedCount: 0,
    watchEvents: events,
    ...extra,
  });

test("simultaneous offline rewatches merge by event identity and remain idempotent", () => {
  const first = video([playback("a", 100)]);
  const second = video([playback("b", 100)]);
  const merged = mergeVideo(first, second);
  assert.equal(merged.intCount, 2);
  assert.equal(merged.watchEvents.length, 2);
  assert.deepEqual(mergeVideo(second, first), merged);
  assert.deepEqual(mergeVideo(merged, first), merged);
  assert.deepEqual(mergeVideo(merged, merged), merged);
});

test("old counts become one saved date and an honest undated count", () => {
  const old = normalizeVideo({ strIdent: id, intTimestamp: 100, intCount: 4 });
  assert.equal(old.intCount, 4);
  assert.equal(old.intUnknownCount, 3);
  const entries = historyEntries([old]);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].intTimestamp, 100);
  assert.equal(entries[1].intTimestamp, 0);
  assert.equal(entries[1].unknownViews, 3);
  const more = mergeVideo(old, video([playback("rewatch", 200)]));
  assert.equal(more.intCount, 5);
  assert.equal(more.intUnknownCount, 3);
  assert.equal(historyEntries([more]).length, 3);
});

test("source imports fill unknown history without inflating counts or discarding dates", () => {
  const old = { strIdent: id, intTimestamp: 200, intCount: 4 };
  const imported = { ...old, intTimestamp: 100, intCount: 1 };
  const merged = mergeVideo(old, imported);
  assert.equal(merged.intCount, 4);
  assert.equal(merged.intUnknownCount, 2);
  assert.deepEqual(
    merged.watchEvents.map((event) => event.watchedAt),
    [100, 200],
  );
  assert.deepEqual(mergeVideo(merged, imported), merged);
});

test("search filters occurrences across dates and keeps stable keys for one video", () => {
  const today = new Date(2026, 10, 1, 12).getTime();
  const yesterday = new Date(2026, 9, 31, 12).getTime();
  const entries = historyEntries([
    video([playback("a", yesterday), playback("b", today)]),
  ]);
  assert.equal(new Set(entries.map((row) => row.entryId)).size, 2);
  const sorted = queryHistory(entries, { now: today });
  assert.equal(sorted[0].intTimestamp, today);
  assert.equal(
    queryHistory(entries, { now: today, period: "today" }).length,
    1,
  );
  assert.equal(
    queryHistory(entries, { now: today, query: "a video" }).length,
    2,
  );
  const rows = historyRows(sorted, { sort: "newest", columns: 1 });
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.doesNotMatch(
    videoCard(sorted[0], false, true, 0, 2),
    /Watched again|Saved watch/,
  );
});

test("deletion hides earlier events and stale future clocks after a new watch", () => {
  const events = [
    playback("old", 100),
    playback("stale-future", 99999),
    playback("new", 301, 300),
  ];
  const restored = video(events, { intDeletedAt: 300, intTimestamp: 301 });
  const entries = historyEntries([restored]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].intTimestamp, 301);
});

test("export/import preserves every event, including two watches at the same time", () => {
  const original = video([playback("a", 100), playback("b", 100)]);
  const imported = normalizeVideo(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(imported, original);
  assert.deepEqual(mergeVideo(original, imported), original);
});

test("exact midnight watches display a time while date-only imports do not", () => {
  const midnight = new Date(2026, 10, 1).getTime();
  assert.match(describeWatchDate(midnight, false, "exact").datetime, /T/);
  assert.equal(describeWatchDate(midnight, false, "day").label, "");
  assert.match(
    describeWatchDate(midnight, false, "day").datetime,
    /^\d{4}-\d{2}-\d{2}$/,
  );
});

test("unavailable timestamps leave the date area and group heading empty", () => {
  const entries = historyEntries([
    normalizeVideo({ strIdent: id, intCount: 3 }),
  ]);
  const html = videoCard(entries[0], false, true, 0, 1);
  assert.doesNotMatch(html, /<time|unavailable|unknown/i);
  assert.match(html, /3 views/);
  assert.equal(historyRows(entries, { sort: "newest", columns: 1 }).length, 1);
});

test("conflicting retry payloads cannot overwrite an event timestamp", () => {
  const first = video([playback("same-id", 100)]);
  assert.throws(
    () => mergeVideo(first, video([playback("same-id", 200)])),
    /immutable watch event/,
  );
  assert.equal(first.watchEvents[0].watchedAt, 100);
});

test("fractional browser timestamps become valid millisecond event times", () => {
  const imported = normalizeVideo({
    strIdent: id,
    intTimestamp: 1234.567,
    intCount: 1,
  });
  assert.equal(imported.intTimestamp, 1234);
  assert.equal(imported.watchEvents[0].watchedAt, 1234);
});

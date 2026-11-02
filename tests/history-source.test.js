import test from "node:test";
import assert from "node:assert/strict";
import { mergeSourceVideo } from "../extension/history/history-source.js";
import { normalizeVideo } from "../extension/history/history-records.js";

const now = new Date(2026, 10, 1, 12).getTime();
const midnight = new Date(2026, 10, 1).getTime();
const source = (at) => ({
  strIdent: "abcdefghijk",
  strTitle: "Title",
  intTimestamp: at,
  intCount: 1,
});
const playback = (eventId, watchedAt) => ({
  eventId,
  watchedAt,
  source: "playback",
  precision: "exact",
});
const tracked = (events) =>
  normalizeVideo({
    ...source(Math.max(...events.map((event) => event.watchedAt))),
    intImportedCount: 0,
    watchEvents: events,
  });
const daySource = (at) => {
  const video = normalizeVideo(source(at));
  video.watchEvents[0].precision = "day";
  return video;
};

test("imports skip a video/timestamp already recorded by playback", () => {
  const existing = tracked([playback("first", now)]);
  assert.deepEqual(mergeSourceVideo(existing, source(now)), existing);
  assert.equal(mergeSourceVideo(existing, source(now)).intCount, 1);
});

test("an existing summary timestamp is sufficient to skip an import", () => {
  const existing = normalizeVideo({ ...source(now), watchEvents: [] });
  assert.deepEqual(mergeSourceVideo(existing, source(now)), existing);
});

test("imports check all saved timestamps, not only the latest summary", () => {
  const existing = tracked([
    playback("first", now),
    playback("later", now + 1000),
  ]);
  assert.deepEqual(mergeSourceVideo(existing, source(now)), existing);
  assert.equal(
    mergeSourceVideo(existing, source(now + 2000)).watchEvents.length,
    3,
  );
});

test("day-only YouTube imports skip activity already recorded on that local day", () => {
  const existing = tracked([playback("first", now)]);
  assert.deepEqual(mergeSourceVideo(existing, daySource(midnight)), existing);
  const imported = daySource(midnight);
  assert.deepEqual(mergeSourceVideo(imported, source(now)), imported);
  const yesterday = daySource(new Date(2026, 9, 31).getTime());
  assert.equal(mergeSourceVideo(existing, yesterday).watchEvents.length, 2);
});

test("partial URL imports keep only new timestamps and do not add duplicate counts", () => {
  const existing = tracked([playback("first", now)]);
  const incoming = normalizeVideo(source(now));
  const later = normalizeVideo(source(now + 1000));
  incoming.watchEvents.push(...later.watchEvents);
  incoming.intImportedCount = 2;
  incoming.intTimestamp = now + 1000;
  const merged = mergeSourceVideo(existing, incoming);
  assert.equal(merged.watchEvents.length, 2);
  assert.equal(merged.intCount, 2);
  assert.deepEqual(mergeSourceVideo(merged, incoming), merged);
});

test("the same timestamp on a different video remains importable", () => {
  const existing = tracked([playback("first", now)]);
  const different = { ...source(now), strIdent: "lmnopqrstuv" };
  assert.equal(mergeSourceVideo(null, different).watchEvents.length, 1);
  assert.equal(existing.strIdent, "abcdefghijk");
});

test("separate real playback identities survive even at identical timestamps", () => {
  const existing = tracked([playback("first", now)]);
  const incoming = tracked([playback("second", now)]);
  assert.equal(mergeSourceVideo(existing, incoming).intCount, 2);
});

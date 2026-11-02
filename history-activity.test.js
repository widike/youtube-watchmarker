import test from "node:test";
import assert from "node:assert/strict";
import { mergeVideo } from "./history-records.js";
import { summarizeHistory } from "./history-statistics.js";
import { estimateHistoryTime } from "./duration-estimates.js";
import { dashboard } from "./ui/statistics-dashboard.js";
import { DAY } from "./statistics-dates.js";

const now = new Date(2026, 10, 1, 20).getTime();
const midnight = new Date(2026, 10, 1).getTime();
const saved = (id, at) => ({
  strIdent: id,
  strTitle: "Imported video",
  intTimestamp: at,
  intCount: 1,
});
const playback = (eventId, watchedAt) => ({
  eventId,
  watchedAt,
  source: "playback",
  precision: "exact",
  observedDeletion: 0,
});
const tracked = (id, events) => ({
  strIdent: id,
  strTitle: "Tracked video",
  intTimestamp: Math.max(...events.map((event) => event.watchedAt)),
  intImportedCount: 0,
  watchEvents: events,
});

test("297 videos plus 216 overlapping source snapshots are not 513 watches", () => {
  const videos = Array.from({ length: 297 }, (_, i) => {
    const id = String(i).padStart(11, "0");
    const initial = saved(id, midnight);
    return i < 216 ? mergeVideo(initial, saved(id, now - 1000)) : initial;
  });
  const before = JSON.stringify(videos);
  const stats = summarizeHistory(videos, { now });
  assert.equal(stats.selected, 297);
  assert.equal(stats.unique, 297);
  assert.equal(stats.approximate, 297);
  assert.equal(stats.favorites[0].count, 1);
  assert.equal(
    stats.daily.reduce((sum, row) => sum + row.count, 0),
    297,
  );
  assert.equal(JSON.stringify(videos), before, "raw evidence must be retained");
  assert.doesNotMatch(dashboard(stats), /repeat watches|rewatches/i);
  assert.match(dashboard(stats), /Recorded activity/);
});

test("a source day and URL snapshots overlap tracked sessions without collapsing actual replays", () => {
  const id = "abcdefghijk";
  const video = mergeVideo(
    mergeVideo(saved(id, midnight), saved(id, now - 1000)),
    tracked(id, [playback("first", now - 2000), playback("replay", now)]),
  );
  const stats = summarizeHistory([video], { now });
  assert.equal(stats.selected, 2);
  assert.equal(stats.exact, 2);
  assert.equal(stats.approximate, 0);
  assert.equal(stats.favorites[0].count, 2);
  assert.equal(
    stats.averageWeek.reduce((sum, cell) => sum + cell.count, 0),
    2,
  );
  const estimates = estimateHistoryTime(
    [video],
    [],
    [
      {
        strIdent: id,
        seconds: 60,
        expiresAt: now + DAY,
      },
    ],
    now,
  );
  assert.equal(
    estimates.rows.reduce((sum, row) => sum + row.milliseconds, 0),
    2000,
    "the first watch stops at replay, which has no elapsed time yet",
  );
});

test("different historical days survive, but imports never establish repeat viewing", () => {
  const video = mergeVideo(
    saved("abcdefghijk", midnight - DAY),
    saved("abcdefghijk", midnight),
  );
  const stats = summarizeHistory([video], { now });
  assert.equal(stats.selected, 2);
  assert.equal(stats.unique, 1);
  assert.equal(stats.approximate, 2);
  assert.doesNotMatch(dashboard(stats), /repeat watches|rewatches/i);
});

test("reconciliation precedes rolling cutoffs and does not use future or deleted evidence", () => {
  const id = "abcdefghijk";
  const video = mergeVideo(
    saved(id, midnight),
    tracked(id, [playback("later", now)]),
  );
  const stats = summarizeHistory([video], { now, period: "day" });
  assert.equal(stats.selected, 1);
  const future = mergeVideo(
    saved(id, midnight),
    tracked(id, [playback("future", now + 1)]),
  );
  const present = summarizeHistory([future], { now });
  assert.equal(present.selected, 1);
  assert.equal(present.future, 1);
  const deleted = { ...video, intDeletedAt: now + 1 };
  assert.equal(summarizeHistory([deleted], { now }).selected, 0);
});

test("duplicate snapshots straddling a cutoff are assigned once to their latest date", () => {
  const reference = new Date(2026, 10, 2, 12).getTime();
  const video = mergeVideo(
    saved("abcdefghijk", midnight + 10 * 3600000),
    saved("abcdefghijk", midnight + 14 * 3600000),
  );
  const stats = summarizeHistory([video], { now: reference, period: "day" });
  assert.equal(stats.selected, 1);
  assert.equal(stats.previous, 0);
});

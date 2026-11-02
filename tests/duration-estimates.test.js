import test from "node:test";
import assert from "node:assert/strict";
import { durationCandidates } from "../extension/duration/duration-estimates.js";
import { summarizeHistory } from "../extension/history/history-statistics.js";
import { DAY, dayKey } from "../extension/statistics/statistics-dates.js";
import { dashboard } from "../extension/ui/statistics-dashboard.js";

const now = new Date(2026, 10, 1, 20).getTime();
const id = "abcdefghijk";
const event = (eventId, watchedAt, extra = {}) => ({
  eventId,
  watchedAt,
  source: "saved",
  precision: "exact",
  observedDeletion: 0,
  ...extra,
});
const video = (watchEvents, extra = {}) => ({
  strIdent: id,
  strTitle: "Space science",
  intTimestamp: watchEvents.at(-1)?.watchedAt || 0,
  intCount: watchEvents.length,
  intUnknownCount: 0,
  watchEvents,
  ...extra,
});
const cached = (seconds = 3600, extra = {}) => ({
  strIdent: id,
  seconds,
  fetchedAt: now - 1,
  expiresAt: now + DAY,
  ...extra,
});

test("historical lengths count once per dated watch, across years and rolling periods", () => {
  const watches = [
    event("old", now - 400 * DAY),
    event("previous", now - 2 * DAY),
    event("recent", now - 1000),
  ];
  const stats = summarizeHistory([video(watches, { intUnknownCount: 20 })], {
    now,
    period: "day",
    durations: [cached()],
  });
  assert.equal(stats.time.selected, 1 / 3600);
  assert.equal(stats.time.estimated, 1 / 3600);
  assert.equal(stats.time.estimatedTotal, 2 + 1 / 3600);
  assert.equal(stats.time.totals.all, 2 + 1 / 3600);
  assert.equal(stats.time.totals.week, 1 + 1 / 3600);
  assert.equal(stats.unknown, 20);
  assert.equal(stats.time.daily.length, 3);
  assert.match(dashboard(stats), /ending when the next video starts/);
  assert.match(dashboard(stats), /not YouTube watch-time data/);
});

test("actual playback replaces only its matching occurrence, preserving historical rewatches", () => {
  const watchEvents = [
    event("saved:first", now - 100 * DAY),
    event("playback:1:doc:session", now - 5000, { source: "playback" }),
  ];
  const measured = [
    {
      strIdent: id,
      eventId: watchEvents[1].eventId,
      minute: now - 1000,
      from: now - 1000,
      to: now,
      milliseconds: 1000,
    },
  ];
  const stats = summarizeHistory([video(watchEvents)], {
    now,
    period: "all",
    time: measured,
    durations: [cached()],
  });
  assert.equal(stats.time.totals.all, 1 + 1 / 3600);
  assert.equal(stats.time.estimated, 1);
  assert.equal(stats.time.missingDaily.length, 0);
});

test("expired, deleted, unavailable, future and undated watches do not invent time", () => {
  for (const durations of [
    [],
    [cached(null)],
    [cached(3600, { expiresAt: now })],
  ]) {
    const stats = summarizeHistory(
      [
        video([event("first", now - 1000), event("future", now + 1000)], {
          intUnknownCount: 20,
        }),
      ],
      { now, period: "all", durations },
    );
    assert.equal(stats.time.totals.all, 0);
    assert.deepEqual(stats.time.missingDaily, [
      { date: dayKey(now - 1000), count: 1 },
    ]);
  }
  const deleted = video([event("first", now - 1000)], { intDeletedAt: now });
  assert.equal(
    summarizeHistory([deleted], { now, durations: [cached()] }).time.selected,
    0,
  );
});

test("day-only imports receive daily hours without fabricated hourly activity", () => {
  const stats = summarizeHistory(
    [video([event("day", now - 1000, { precision: "day" })])],
    { now, durations: [cached()] },
  );
  assert.equal(stats.time.selected, 1);
  assert.equal(
    stats.time.averageWeek.reduce((sum, row) => sum + row.count, 0),
    0,
  );
  assert.equal(stats.time.daily[0].count, 1);
});

test("newest queue order uses dated events, deduplicates videos, and ignores deleted/future/undated records", () => {
  const videos = [
    video([event("first", now - DAY)]),
    video([event("new", now - 1)]),
    video([event("second", now - 2)], { strIdent: "aaaaaaaaaaa" }),
    video([event("deleted", now - 1)], {
      strIdent: "deleted____",
      intDeletedAt: now,
    }),
    video([], { strIdent: "undated____", intCount: 100 }),
    video([event("future", now + DAY)], { strIdent: "future_____" }),
  ];
  assert.deepEqual(durationCandidates(videos, now), [id, "aaaaaaaaaaa"]);
});

test("events exactly at a rolling cutoff are counted in the selected window once", () => {
  const stats = summarizeHistory([video([event("cutoff", now - DAY)])], {
    now,
    period: "day",
    durations: [cached()],
  });
  assert.equal(stats.time.selected, 1);
  assert.equal(stats.time.previous, 0);
});

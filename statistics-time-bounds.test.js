import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "./history-statistics.js";
import { budgetWatchTime } from "./watch-time-budgets.js";
import { DAY, dayKey, PERIODS } from "./statistics-dates.js";
import { dashboard } from "./ui/statistics-dashboard.js";

const HOUR = 3_600_000;
const now = new Date(2026, 10, 2, 12).getTime();
const id = "abcdefghijk";
const event = (watchedAt, index = 0) => ({
  eventId: `watch:${index}`,
  watchedAt,
  source: "playback",
  precision: "exact",
  observedDeletion: 0,
});
const video = (events) => ({
  strIdent: id,
  strTitle: "Video",
  watchEvents: events,
  intUnknownCount: 0,
});
const cache = (seconds) => [{ strIdent: id, seconds, expiresAt: now + DAY }];
const estimate = (at, hours) => ({
  strIdent: id,
  minute: at,
  from: at,
  to: at,
  milliseconds: hours * HOUR,
  estimated: true,
});
const measured = (from, to) => ({
  strIdent: id,
  minute: Math.floor(from / 60_000) * 60_000,
  from,
  to,
  milliseconds: to - from,
});

test("invalid cached lengths cannot inflate history statistics", () => {
  for (const seconds of [Infinity, NaN, "3600", -1]) {
    const stats = summarizeHistory([video([event(now - 1000)])], {
      now,
      period: "all",
      durations: cache(seconds),
    });
    assert.equal(stats.selected, 1);
    assert.equal(stats.time.selected, 0);
    assert.equal(stats.time.estimatedTotal, 0);
    assert.equal(stats.time.daily.length, 0);
    assert.deepEqual(stats.time.missingDaily, [
      { date: dayKey(now), count: 1 },
    ]);
    assert.doesNotMatch(dashboard(stats), /NaN|Infinity|152 h/);
  }
});

test("date-only long videos use a shared daily budget across metrics and charts", () => {
  const events = Array.from({ length: 20 }, (_, index) => ({
    ...event(new Date(2026, 9, 30, index).getTime(), index),
    precision: "day",
  }));
  const stats = summarizeHistory([video(events)], {
    now,
    period: "all",
    durations: cache(12 * 3600),
  });
  assert.equal(stats.selected, 20);
  assert(Math.abs(stats.time.selected - 24) < 1e-10);
  assert(Math.abs(stats.time.estimatedTotal - 24) < 1e-10);
  assert(Math.abs(stats.time.daily[0].count - 24) < 1e-10);
  assert.equal(stats.time.timeline[0].count, stats.time.selected);
  assert.equal(stats.time.totals.all, stats.time.selected);
  assert(stats.time.average <= 24);
});

test("estimates share time left after measured playback without modifying measurements", () => {
  const start = new Date(2026, 9, 30).getTime();
  const playback = Array.from({ length: 120 }, (_, minute) =>
    measured(start + minute * 60_000, start + (minute + 1) * 60_000),
  );
  const rows = [estimate(start + 3 * HOUR, 24), estimate(start + 4 * HOUR, 24)];
  const budget = budgetWatchTime([...rows, ...playback], 0, now);
  assert(Math.abs(budget[0].count - 11) < 1e-10);
  assert(Math.abs(budget[1].count - 11) < 1e-10);
  for (const value of budget.slice(2)) assert.equal(value.count, 1 / 60);
  assert.equal(rows[0].milliseconds, DAY);

  // Concurrent devices can legitimately exceed the budget. Preserve their data.
  const concurrent = budgetWatchTime(
    [
      ...Array.from({ length: 1500 }, () => measured(start, start + 60_000)),
      rows[0],
    ],
    0,
    now,
  );
  assert.equal(concurrent.at(-1).count, 0);
  assert(concurrent.slice(0, -1).every(({ count }) => count === 1 / 60));
});

test("today's estimates stop at now and rolling windows respect partial days", () => {
  const dayEvent = (at, index) => ({ ...event(at, index), precision: "day" });
  const videos = [
    video([dayEvent(now - DAY - 1000, 0), dayEvent(now - 1000, 1)]),
  ];
  for (const [period, { days }] of Object.entries(PERIODS)) {
    const stats = summarizeHistory(videos, {
      now,
      period,
      durations: cache(24 * 3600),
    });
    const today = stats.time.daily.find(({ date }) => date === dayKey(now));
    assert.equal(today.count, 12);
    if (days) assert(stats.time.selected <= days * 24);
    assert(stats.time.average <= 24);
    assert.equal(stats.time.selected, stats.time.totals[period]);
    assert.equal(
      stats.time.selected,
      stats.time.timeline.reduce((sum, { count }) => sum + count, 0),
    );
    if (period === "day") {
      assert.equal(stats.time.selected, 12);
      assert.equal(stats.time.previous, 12);
    }
  }
  const bothDays = summarizeHistory(
    [video([dayEvent(now - 23 * HOUR, 0), dayEvent(now - 1000, 1)])],
    { now, period: "day", durations: cache(24 * 3600) },
  );
  assert.equal(bothDays.time.selected, 24);
  assert.equal(bothDays.time.timeline.length, 2);
});

test("daily budgets use actual local day length across daylight-saving transitions", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    for (const [month, day, expected] of [
      [2, 29, 23],
      [9, 25, 25],
    ]) {
      const start = new Date(2026, month, day).getTime();
      const end = new Date(2026, month, day + 1).getTime();
      const values = budgetWatchTime(
        [estimate(start + HOUR, 20), estimate(start + 2 * HOUR, 20)],
        start,
        end,
      );
      assert.equal(
        values.reduce((sum, { count }) => sum + count, 0),
        expected,
      );
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

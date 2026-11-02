import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "./history-statistics.js";
import { DAY, dayKey } from "./statistics-dates.js";

const HOUR = 3_600_000;
const now = new Date(2026, 10, 2, 12).getTime();
const at = (hour, minute = 0) => new Date(2026, 10, 2, hour, minute).getTime();
const first = "fireplace__";
const second = "nextvideo__";
const video = (strIdent, watchedAt, precision = "exact") => ({
  strIdent,
  strTitle: strIdent,
  intUnknownCount: 0,
  watchEvents: [
    {
      eventId: strIdent,
      watchedAt,
      source: "playback",
      precision,
      observedDeletion: 0,
    },
  ],
});
const length = (strIdent, hours) => ({
  strIdent,
  seconds: hours * 3600,
  expiresAt: now + DAY,
});
const stats = (videos, durations = [], extra = {}) =>
  summarizeHistory(videos, {
    now,
    period: "all",
    durations,
    ...extra,
  });

test("a new video stops a 10-hour fireplace estimate after 15 minutes", () => {
  // Deliberately reverse storage order: the sequence must use timestamps.
  const result = stats(
    [video(second, at(10, 15)), video(first, at(10))],
    [length(first, 10), length(second, 0.5)],
  );
  assert.equal(result.time.selected, 0.75);
  assert.equal(result.time.estimated, 0.75);
  assert.equal(result.time.daily[0].count, 0.75);
  assert.equal(
    result.time.averageWeek.reduce((sum, { count }) => sum + count, 0),
    0.75,
  );
});

test("known length ends a short video before the next starts, excluding idle gaps", () => {
  const result = stats(
    [video(first, at(8)), video(second, at(11, 55))],
    [length(first, 0.25), length(second, 10)],
  );
  assert.equal(result.time.selected, 0.25 + 5 / 60);
});

test("next starts end estimates even without duration metadata or with measured playback", () => {
  const videos = [video(first, at(10)), video(second, at(10, 15))];
  assert.equal(stats(videos, [length(first, 10)]).time.selected, 0.25);
  assert.equal(stats(videos).time.selected, 0.25);
  const result = stats(videos, [length(first, 10), length(second, 10)], {
    time: [
      {
        strIdent: second,
        eventId: second,
        minute: at(10, 15),
        from: at(10, 15),
        to: at(10, 16),
        milliseconds: 60_000,
      },
    ],
  });
  assert.equal(result.time.estimated, 0.25);
  assert.equal(result.time.selected, 0.25 + 1 / 60);
});

test("timestamped intervals split at midnight and prorate rolling cutoffs", () => {
  const start = new Date(2026, 10, 1, 23, 50).getTime();
  const end = at(0, 10);
  const videos = [video(first, start), video(second, end)];
  const durations = [length(first, 10)];
  const result = stats(videos, durations);
  assert(Math.abs(result.time.selected - 1 / 3) < 1e-10);
  assert.deepEqual(result.time.daily, [
    { date: dayKey(start), count: 1 / 6 },
    { date: dayKey(end), count: 1 / 6 },
  ]);
  const rolling = stats(videos, durations, { period: "day", now: at(0) + DAY });
  assert.equal(rolling.time.selected, 1 / 6);
  assert.equal(rolling.time.previous, 1 / 6);
});

test("date-only observations cannot terminate a timestamped watch", () => {
  const result = stats(
    [video(first, at(8)), video(second, at(9), "day")],
    [length(first, 2)],
  );
  assert.equal(result.time.selected, 2);
});

test("same-timestamp watches share the available interval", () => {
  const result = stats(
    [
      video(first, at(10)),
      video(second, at(10)),
      video("thirdvideo_", at(10, 30)),
    ],
    [length(first, 10), length(second, 10)],
  );
  assert.equal(result.time.selected, 0.5);
});

test("very long cached streams use next timestamps and at most a day for the last watch", () => {
  const result = stats(
    [video(first, at(10)), video(second, at(10, 15))],
    [length(first, 65_000)],
  );
  assert.equal(result.time.selected, 0.25);
  assert.equal(
    stats([video(first, now - 10 * DAY)], [length(first, 65_000)]).time
      .selected,
    24,
  );
});

test("estimated intervals advance through the repeated daylight-saving hour", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    const start = Date.parse("2026-10-25T00:30:00Z");
    const end = Date.parse("2026-10-25T02:30:00Z");
    const result = stats(
      [video(first, start), video(second, end)],
      [length(first, 10)],
    );
    assert.equal(result.time.selected, (end - start) / HOUR);
    assert.equal(result.time.daily.length, 1);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

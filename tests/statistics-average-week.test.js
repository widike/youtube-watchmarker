import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "../extension/history/history-statistics.js";
import { DAY, PERIODS } from "../extension/statistics/statistics-dates.js";
import { averageWeek } from "../extension/ui/statistics-heatmaps.js";
import { parseHistoryImport } from "../extension/history/history-import.js";

const now = new Date(2026, 10, 2, 18).getTime();
const video = (index, at, precision) => ({
  strIdent: String(index).padStart(11, "a"),
  strTitle: "Imported history",
  intTimestamp: at,
  intCount: 1,
  watchEvents: [
    {
      eventId: `watch:${index}`,
      watchedAt: at,
      source: "saved",
      precision,
      observedDeletion: 0,
    },
  ],
});
const cells = (stats) =>
  [...averageWeek(stats).matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
const active = (cell) => !cell.includes('data-level="0"');

test("date-only imports add no hourly cells or placeholders in any period", () => {
  const videos = [0, 2, 10, 40, 100, 400].map((age, i) =>
    video(i, now - age * DAY, "day"),
  );
  for (const period of Object.keys(PERIODS)) {
    const stats = summarizeHistory(videos, { period, now });
    const grid = cells(stats);
    assert.equal(grid.length, 168);
    assert(stats.selected > 0);
    assert(grid.every((cell) => !active(cell)));
    assert.doesNotMatch(averageWeek(stats), /unknown|missing|\?/i);
  }
});

test("saved timestamps from original database imports highlight their actual weekdays and hours", () => {
  const originals = Array.from({ length: 7 }, (_, day) =>
    [8, 12, 16].map((hour) => ({
      strIdent: `${day}${hour}`.padStart(11, "v"),
      strTitle: "Saved video with a play timestamp",
      intTimestamp: new Date(2026, 10, 2 - day, hour, 30).getTime(),
      intCount: 1,
    })),
  ).flat();
  for (const raw of [
    JSON.stringify(originals),
    Buffer.from(JSON.stringify(originals)).toString("base64"),
  ]) {
    const imported = parseHistoryImport(raw);
    assert(
      imported.every((row) => row.watchEvents[0].precision === "inferred"),
    );
    for (const [period, { days }] of Object.entries(PERIODS)) {
      const expected = Array(168).fill(0);
      for (const row of originals) {
        if (days && row.intTimestamp < now - days * DAY) continue;
        const date = new Date(row.intTimestamp);
        expected[((date.getDay() + 6) % 7) * 24 + date.getHours()]++;
      }
      const stats = summarizeHistory(imported, { period, now });
      assert.deepEqual(
        stats.averageWeek.map(({ count }) => count),
        expected,
        period,
      );
      assert.deepEqual(
        cells(stats).map(active),
        expected.map((count) => count > 0),
        period,
      );
      assert.equal(
        stats.exact,
        0,
        "Showing a timestamp must not relabel imported evidence",
      );
      assert.doesNotMatch(averageWeek(stats), /unknown|missing|\?/i);
    }
  }
});

test("only date-only midnight placeholders are omitted; an explicit midnight playback is included", () => {
  const midnight = new Date(2026, 10, 2).getTime();
  const stats = summarizeHistory(
    [
      video(0, midnight, "inferred"),
      video(1, midnight, "exact"),
      video(2, midnight + 60_000, "inferred"),
      video(3, midnight + 3_600_000, "day"),
    ],
    { period: "day", now },
  );
  assert.equal(stats.selected, 4);
  assert.equal(stats.averageWeek[0].count, 2);
  assert.equal(stats.averageWeek[1].count, 0);
  assert.equal(cells(stats).filter(active).length, 1);
});

test("date-only duration estimates cannot hide exact-hour activity records", () => {
  const at = now - 3_600_000;
  const midnight = new Date(2026, 10, 2).getTime();
  const videos = [video(0, at, "exact"), video(1, midnight, "day")];
  const durations = [
    { strIdent: videos[1].strIdent, seconds: 3600, expiresAt: now + DAY },
  ];
  const stats = summarizeHistory(videos, { period: "week", now, durations });
  assert(stats.time.selected > 0);
  assert.equal(
    stats.time.averageWeek.reduce((sum, row) => sum + row.count, 0),
    0,
  );
  const grid = cells(stats);
  assert(active(grid[17]), "Exact 17:00 activity was hidden by date-only time");
  assert.equal(grid.filter(active).length, 1);
  assert.match(grid[17], /17:00.*records\/day on average/);
});

test("measured playback does not change the weekly chart's activity units or totals", () => {
  const from = now - 3_600_000;
  const videos = [video(0, from, "exact"), video(1, now - DAY, "day")];
  const stats = summarizeHistory(videos, { period: "week", now });
  const measured = summarizeHistory(videos, {
    period: "week",
    now,
    time: [
      {
        strIdent: videos[0].strIdent,
        eventId: "watch:0",
        minute: from,
        from,
        to: from + 60_000,
        milliseconds: 60_000,
      },
    ],
  });
  assert(measured.time.selected > 0);
  assert.equal(averageWeek(measured), averageWeek(stats));
  assert.doesNotMatch(averageWeek(measured), /NaN|Infinity|undefined/);
});

test("empty periods remain empty without marking known empty hours as missing", () => {
  const stats = summarizeHistory([video(0, now - 2 * DAY, "day")], {
    period: "day",
    now,
  });
  assert.equal(stats.selected, 0);
  assert(cells(stats).every((cell) => !active(cell)));
  assert.doesNotMatch(averageWeek(stats), /stats-cell-missing|NaN|Infinity/);
});

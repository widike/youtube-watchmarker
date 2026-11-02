import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "./history-statistics.js";
import { DAY, PERIODS } from "./statistics-dates.js";
import { averageWeek, calendar } from "./ui/statistics-heatmaps.js";
import { dateLabel } from "./ui/statistics-format.js";

const now = new Date(2026, 10, 1, 12).getTime();
const ages = [0, 2, 10, 40, 100, 400];
const videos = ages.flatMap((age, index) =>
  [0, 1].map((copy) => ({
    strIdent: `${index}${copy}`.padEnd(11, "a"),
    strTitle: `Topic${index} science`,
    intTimestamp: now - age * DAY,
    intCount: 1000, // Lifetime counts must never become period counts.
    intUnknownCount: 999 - index,
    watchEvents: Array.from({ length: index + 1 }, (_, watch) => ({
      eventId: `${index}:${copy}:${watch}`,
      watchedAt: now - age * DAY,
      source: "playback",
      precision: "exact",
      observedDeletion: 0,
    })),
  })),
);

test("every period filters rankings, title words, weekday averages and hourly activity together", () => {
  for (const [index, period] of Object.keys(PERIODS).entries()) {
    const stats = summarizeHistory(videos, { period, now });
    const expectedWatches = (index + 1) * (index + 2);
    assert.equal(stats.selected, expectedWatches, period);
    assert.equal(stats.unique, 2 * (index + 1), period);
    assert.equal(stats.favorites[0].strIdent, videos[2 * index].strIdent);
    assert.equal(stats.favorites[0].count, index + 1);
    assert(stats.favorites.every(({ count }) => count <= index + 1));
    assert.deepEqual(
      stats.words.filter(({ word }) => word.startsWith("topic")),
      ages.slice(0, index + 1).map((_, i) => ({ word: `topic${i}`, count: 2 })),
    );
    assert.equal(
      stats.weekdayAverages.reduce((sum, { count }) => sum + count, 0),
      expectedWatches,
    );
    assert.equal(
      stats.averageWeek.reduce((sum, { count }) => sum + count, 0),
      expectedWatches,
    );
    for (const [day, { count, average }] of stats.weekdayAverages.entries())
      assert.equal(average, count / (stats.weekdays[day] || 1));
  }
});

test("average week shows saved dated activity without requiring measured playback duration", () => {
  const stats = summarizeHistory(videos, { period: "month", now });
  assert(
    stats.time.estimated > 0,
    "timestamps can estimate time without measurements",
  );
  const html = averageWeek(stats);
  assert.match(html, /Average records per weekday/);
  assert(stats.weekdayAverages.some(({ average }) => average > 0));
  assert.doesNotMatch(html, /stats-cell-detail|Local time|stats-legend/);
  assert.doesNotMatch(html, /NaN|Infinity/);

  const imports = summarizeHistory(
    [
      {
        strIdent: "abcdefghijk",
        strTitle: "Imported",
        intTimestamp: now,
        intCount: 20,
      },
    ],
    { period: "month", now },
  );
  assert.equal(imports.selected, 1);
  assert.equal(imports.exact, 0);
  assert.equal(imports.weekdayAverages[6].count, 1);
  assert.equal(imports.unknown, 19);
  assert.equal(
    imports.averageWeek.reduce((sum, { count }) => sum + count, 0),
    1,
  );
  assert.match(averageWeek(imports), /Average records per weekday/);
});

test("calendar totals and cells use complete annual history for every selected period", () => {
  const month = summarizeHistory(videos, { period: "month", now });
  const all = summarizeHistory(videos, { period: "all", now });
  const selectedYear = calendar(month, 2026);
  assert.match(selectedYear, /30 records/);
  assert.doesNotMatch(selectedYear, /Outside selected period|unavailable/i);
  assert.match(calendar(all, 2026), /30 records/);
  assert.match(calendar(month, 2025), /12 records/);
  assert.match(calendar(all, 2025), /12 records/);
  for (const period of Object.keys(PERIODS)) {
    const stats = summarizeHistory(videos, { period, now });
    assert.equal(calendar(stats, 2025), calendar(all, 2025), period);
    assert.equal(calendar(stats, 2026), calendar(all, 2026), period);
  }
  assert.match(calendar(month, 2025), /data-level="[1-4]"/);
  assert.doesNotMatch(calendar(month, 2025), /stats-cell-missing/);
});

test("duration outside the selected period cannot hide its known hourly watch activity", () => {
  const from = now - 40 * DAY;
  const stats = summarizeHistory(videos.slice(0, 1), {
    period: "month",
    now,
    time: [
      {
        strIdent: "abcdefghijk",
        minute: from,
        from,
        to: from + 60_000,
        milliseconds: 60_000,
      },
    ],
  });
  assert(stats.time.first);
  assert.equal(stats.time.selected, 0);
  const html = averageWeek(stats);
  assert.match(html, /records.*on average/);
  assert.match(html, /data-level="[1-4]"/);
});

test("all-time calendar includes playback recorded before the earliest watch event", () => {
  const from = new Date(2025, 10, 1, 10).getTime();
  const stats = summarizeHistory([], {
    period: "all",
    now,
    time: [
      {
        strIdent: "abcdefghijk",
        minute: from,
        from,
        to: from + 60_000,
        milliseconds: 60_000,
      },
    ],
  });
  const html = calendar(stats, 2025);
  assert.match(html, /1 min 0 s/);
  assert(
    html.includes(`${dateLabel("2025-11-01")}: 1 min 0 s; 0 activity records`),
  );
  assert.equal(
    calendar(
      summarizeHistory([], {
        period: "month",
        now,
        time: [
          {
            strIdent: "abcdefghijk",
            minute: from,
            from,
            to: from + 60_000,
            milliseconds: 60_000,
          },
        ],
      }),
      2025,
    ),
    html,
  );
});

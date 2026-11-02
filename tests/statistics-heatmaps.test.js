import test from "node:test";
import assert from "node:assert/strict";
import {
  calendar,
  calendarLegend,
} from "../extension/ui/statistics-heatmaps.js";
import { dateLabel, escape } from "../extension/ui/statistics-format.js";

const stats = {
  now: new Date(2026, 10, 1, 12).getTime(),
  daily: [
    { date: "2025-02-01", count: 20 },
    { date: "2026-01-01", count: 7 },
    { date: "2026-01-02", count: 20 },
    { date: "2026-01-03", count: 10 },
    { date: "2026-01-04", count: 50 },
    { date: "2026-01-05", count: 5 },
  ],
  time: {
    first: "2026-01-02",
    daily: [
      { date: "2026-01-02", count: 1 },
      { date: "2026-01-04", count: 0.1 },
      { date: "2026-01-05", count: 0 },
      { date: "2026-01-06", count: 3 },
    ],
    missingDaily: [{ date: "2026-01-04", count: 49 }],
    estimatedTotal: 0,
  },
};

function day(html, date) {
  const button = [...html.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => tag)
    .find((tag) => tag.includes(`aria-label="${escape(dateLabel(date))}:`));
  assert(button, `Missing cell for ${date}`);
  return button;
}

test("calendar chooses time or records per day, including gaps after tracking began", () => {
  const html = calendar(stats, 2026);
  for (const [date, level] of [
    ["2026-01-01", 2], // Earlier than the first duration.
    ["2026-01-02", 3], // One hour takes priority over 20 records.
    ["2026-01-03", 3], // A gap between days with duration.
    ["2026-01-04", 1], // Partial duration takes priority over 50 records.
    ["2026-01-05", 2], // Zero duration falls back to records.
    ["2026-01-06", 4], // Duration without a matching activity record.
    ["2026-01-07", 0], // Empty day.
  ])
    assert.match(day(html, date), new RegExp(`data-level="${level}"`), date);

  assert.match(day(html, "2026-01-01"), /: 7 activity records/);
  assert.doesNotMatch(day(html, "2026-01-01"), /stats-cell-missing/);
  assert.match(day(html, "2026-01-02"), /: 1 h 0 min; 20 activity records/);
  assert.match(day(html, "2026-01-04"), /49 watches without duration/);
  assert.match(day(html, "2026-01-07"), /: 0 activity records/);
  assert.match(html, /\(partial\)/);

  const past = calendar(stats, 2025);
  assert.match(day(past, "2025-02-01"), /data-level="4"/);
  assert.match(day(past, "2025-02-01"), /: 20 activity records/);
  assert.doesNotMatch(past, /stats-cell-missing|\(partial\)/);
});

test("mixed calendar explains both scales in one shared legend", () => {
  const html = calendarLegend(stats);
  assert.match(html, /Hours per day/);
  assert.match(html, /Records per day · when watch time is missing/);
  assert.equal([...html.matchAll(/class="stats-legend"/g)].length, 1);
  assert.equal([...html.matchAll(/data-level=/g)].length, 10);
});

test("calendar legends show only the scales used and retain the estimate indicator", () => {
  const counts = { ...stats, time: { ...stats.time, daily: [], first: null } };
  assert.match(calendar(counts, 2026), /data-level="4"/);
  assert.doesNotMatch(calendar(counts, 2026), /stats-cell-missing/);
  assert.match(calendarLegend(counts), /aria-label="Records per day"/);
  assert.doesNotMatch(calendarLegend(counts), /Hours per day/);

  const time = { ...stats, daily: [] };
  assert.match(calendarLegend(time), /aria-label="Hours per day"/);
  assert.doesNotMatch(calendarLegend(time), /Records per day/);
  assert.match(
    calendarLegend({ ...time, time: { ...time.time, estimatedTotal: 1 } }),
    /includes estimates/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "./history-statistics.js";
import { DAY, calendarDays, dayKey, localDate } from "./statistics-dates.js";
import { commonWords, titleWords } from "./statistics-words.js";
import { timelineData } from "./ui/statistics-charts.js";
import { popupStatistics } from "./ui/popup-statistics.js";
import { dashboard } from "./ui/statistics-dashboard.js";

const now = new Date(2026, 10, 1, 12).getTime();
const event = (id, at, precision = "exact", source = "playback") => ({
  eventId: id,
  watchedAt: at,
  precision,
  source,
  observedDeletion: 0,
});
const video = (id, events, extra = {}) => ({
  strIdent: id,
  strTitle: "Space science",
  watchEvents: events,
  intTimestamp: Math.max(0, ...events.map(({ watchedAt }) => watchedAt)),
  intCount: events.length,
  intUnknownCount: 0,
  ...extra,
});

test("rolling periods count watch occurrences, boundaries and comparisons exactly", () => {
  const stats = summarizeHistory(
    [
      video("abcdefghijk", [
        event("now", now),
        event("same-ms", now),
        event("boundary", now - DAY),
        event("before", now - DAY - 1),
        event("previous-boundary", now - 2 * DAY),
      ]),
      video("lmnopqrstuv", [event("future", now + 1)]),
    ],
    { period: "day", now },
  );
  assert.equal(stats.selected, 3);
  assert.equal(stats.previous, 2);
  assert.equal(stats.unique, 1);
  assert.equal(Object.hasOwn(stats, "rewatches"), false);
  assert.equal(stats.totals.all, 5);
  assert.equal(stats.totals.day, 3);
  assert.equal(stats.future, 1);
  assert.equal(stats.average, 3);
  assert.equal(stats.favorites[0].count, 3);
  assert.equal(
    stats.timeline.reduce((n, { count }) => n + count, 0),
    3,
  );
  assert.equal(
    timelineData(stats).points.reduce((n, { count }) => n + count, 0),
    3,
  );
});

test("inferred imports use their saved hours while date-only and undated imports do not", () => {
  const stats = summarizeHistory(
    [
      video("abcdefghijk", [
        event("day", now - DAY, "day", "saved"),
        event("inferred", now - 2 * DAY, "inferred", "saved"),
        event("exact", now),
      ]),
      {
        strIdent: "lmnopqrstuv",
        strTitle: "Old title",
        intTimestamp: now - 3 * DAY,
        intCount: 10,
      },
      video("zzzzzzzzzzz", [event("receipt", 0, "exact", "receipt")]),
    ],
    { period: "all", now },
  );
  assert.equal(stats.selected, 4);
  assert.equal(stats.approximate, 3);
  assert.equal(stats.exact, 1);
  assert.equal(stats.unknown, 9);
  assert.equal(
    stats.averageWeek.reduce((n, { count }) => n + count, 0),
    3,
  );
  for (const [age, count] of [
    [1, 0],
    [2, 1],
    [3, 1],
  ]) {
    const date = new Date(now - age * DAY);
    const index = ((date.getDay() + 6) % 7) * 24 + date.getHours();
    assert.equal(stats.averageWeek[index].count, count);
  }
  assert.equal(
    stats.daily.reduce((n, { count }) => n + count, 0),
    4,
  );
});

test("deleted and pre-deletion events are excluded, explicit restored watches survive", () => {
  const deleted = now - DAY;
  const restored = event("restored", now);
  restored.observedDeletion = deleted;
  const stats = summarizeHistory(
    [
      video("abcdefghijk", [event("old", now - 3 * DAY)], {
        intDeletedAt: deleted,
      }),
      video("lmnopqrstuv", [event("old", now - 2 * DAY), restored], {
        intDeletedAt: deleted,
      }),
    ],
    { period: "all", now },
  );
  assert.equal(stats.selected, 1);
  assert.equal(stats.unique, 1);
  assert.equal(stats.favorites[0].strIdent, "lmnopqrstuv");
});

test("average week includes inactive weekdays, separates hours and uses local calendar dates", () => {
  const end = new Date(2026, 8, 21, 23, 59).getTime();
  const monday = new Date(2026, 8, 21, 20, 30).getTime();
  const stats = summarizeHistory(
    [video("abcdefghijk", [event("exact", monday)])],
    { period: "week", now: end },
  );
  assert.equal(stats.averageWeek[20].count, 1);
  assert.equal(stats.weekdays[0], 2); // Both partially observed Mondays.
  assert.equal(stats.averageWeek[20].average, 0.5);
  assert.equal(stats.activeDays, 1);
  assert.equal(stats.average, 1 / 7);
});

test("calendar stepping covers leap days and DST without duplicating dates", () => {
  const leap = calendarDays(new Date(2024, 0, 1), new Date(2024, 11, 31));
  assert.equal(leap.length, 366);
  assert(leap.includes("2024-02-29"));
  for (const month of [2, 9]) {
    const dates = calendarDays(
      new Date(2026, month, 20),
      new Date(2026, month + 1, 2),
    );
    assert.equal(new Set(dates).size, dates.length);
    for (const date of dates) assert.equal(dayKey(localDate(date)), date);
  }
});

test("streaks cross year boundaries and can end yesterday", () => {
  const end = new Date(2026, 0, 3, 12).getTime();
  const watches = [
    new Date(2025, 11, 30),
    new Date(2025, 11, 31),
    new Date(2026, 0, 1),
    new Date(2026, 0, 2),
  ];
  const stats = summarizeHistory(
    [
      video(
        "abcdefghijk",
        watches.map((date, i) => event(String(i), date.getTime())),
      ),
    ],
    { period: "all", now: end },
  );
  assert.deepEqual(stats.streak, { current: 4, longest: 4 });
});

test("word cloud removes filler words and counts each distinct title once", () => {
  assert.deepEqual(
    titleWords("The a AND NASA NASA für die Straße — Über science!"),
    ["nasa", "straße", "science"],
  );
  const words = commonWords([
    { strTitle: "The NASA NASA space" },
    { strTitle: "A NASA space launch" },
    { strTitle: "Die Straße NASA" },
  ]);
  assert.deepEqual(words, [
    { word: "nasa", count: 3 },
    { word: "space", count: 2 },
  ]);
  const stats = summarizeHistory(
    [
      video(
        "abcdefghijk",
        Array.from({ length: 20 }, (_, i) => event(String(i), now)),
        { strTitle: "Space space" },
      ),
      video("lmnopqrstuv", [event("second", now)], {
        strTitle: "Space exploration",
      }),
    ],
    { period: "all", now },
  );
  assert.deepEqual(stats.words, [{ word: "space", count: 2 }]);
});

test("empty data and hostile titles produce finite, safe accessible markup", () => {
  const empty = summarizeHistory([], { period: "all", now });
  assert.equal(empty.average, 0);
  assert.equal(empty.first, null);
  assert.deepEqual(empty.streak, { current: 0, longest: 0 });
  assert.doesNotMatch(dashboard(empty), /NaN|Infinity|undefined/);
  const stats = summarizeHistory(
    [
      video("abcdefghijk", [event("safe", now)], {
        strTitle: '<img src=x onerror="alert(1)">',
      }),
    ],
    { now },
  );
  const html = dashboard(stats);
  assert(!html.includes("<img"));
  assert(html.includes("&lt;img"));
  assert(html.includes('aria-labelledby="stats-calendar-2026"'));
  assert(html.includes('aria-label="Average week.'));
  assert.doesNotMatch(
    html,
    /unavailable|No duration data|Hours watched|Daily viewing time|<h2>Viewing time/i,
  );
  assert.match(html, /records\s*\/\s*day/i);
  assert.match(html, /stats-metrics-counts/);
  const popup = popupStatistics(stats);
  assert.match(popup, /No watch time recorded/);
  assert.match(popup, /stats-peek-duration-value" aria-hidden="true">—/);
  assert.doesNotMatch(popup, /records|stats-peek-number|stats-peek-bars/);
});

test("long timelines aggregate monthly without losing zero-activity months", () => {
  const stats = summarizeHistory(
    [
      video("abcdefghijk", [
        event("past", new Date(2023, 0, 1).getTime()),
        event("now", now),
      ]),
    ],
    { period: "all", now },
  );
  const { monthly, points } = timelineData(stats);
  assert(monthly);
  assert.equal(points[0].date, "2023-01");
  assert.equal(points.at(-1).date, "2026-11");
  assert.equal(
    points.reduce((n, { count }) => n + count, 0),
    2,
  );
  assert(points.some(({ count }) => count === 0));
});

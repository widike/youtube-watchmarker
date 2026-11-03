import test from "node:test";
import assert from "node:assert/strict";
import { summarizeHistory } from "../extension/history/history-statistics.js";
import { summarizePopupHistory } from "../extension/history/history-popup-statistics.js";
import { popupStatistics } from "../extension/ui/popup-statistics.js";
import { DAY } from "../extension/statistics/statistics-dates.js";

const now = new Date(2026, 10, 1, 12).getTime();
const event = (eventId, watchedAt, extra = {}) => ({
  eventId,
  watchedAt,
  source: "playback",
  precision: "exact",
  observedDeletion: 0,
  ...extra,
});
const videos = [
  {
    strIdent: "abcdefghijk",
    strTitle: "Repeated video",
    intTimestamp: now,
    intUnknownCount: 5,
    watchEvents: [
      event("old", now - 400 * DAY),
      event("month", now - 30 * DAY),
      event("week", now - 7 * DAY),
      event("day", now - DAY),
      event("simultaneous", now - DAY),
      event("recent", now - 1000),
      event("future", now + DAY),
    ],
  },
  {
    strIdent: "lmnopqrstuv",
    strTitle: "Overlapping imports",
    intTimestamp: now - 2 * DAY,
    watchEvents: [
      event("imported-day", now - 2 * DAY, {
        source: "saved",
        precision: "day",
      }),
      event("imported-visit", now - 2 * DAY + 1000, { source: "saved" }),
    ],
  },
  {
    strIdent: "deleted____",
    intTimestamp: now - DAY,
    intDeletedAt: now,
    watchEvents: [event("deleted", now - DAY)],
  },
];

for (const [name, options] of Object.entries({
  empty: { videos: [] },
  "missing durations": { videos },
  estimates: {
    videos,
    durations: videos.map(({ strIdent }) => ({
      strIdent,
      seconds: 36_000,
      expiresAt: now + DAY,
    })),
  },
  "measured time and expired metadata": {
    videos,
    time: [
      {
        strIdent: "abcdefghijk",
        eventId: "recent",
        from: now - 1000,
        to: now,
        minute: now - 1000,
        milliseconds: 1000,
      },
      {
        strIdent: "deleted____",
        from: now - DAY,
        to: now - DAY + 1000,
        minute: now - DAY,
        milliseconds: 1000,
      },
    ],
    durations: [{ strIdent: "abcdefghijk", seconds: 600, expiresAt: now }],
  },
})) {
  test(`popup totals match the full dashboard for ${name}`, () => {
    const full = summarizeHistory(options.videos, { ...options, now });
    const compact = summarizePopupHistory(options.videos, { ...options, now });
    for (const period of ["day", "week", "month"]) {
      assert.equal(compact.totals[period], full.totals[period]);
      assert.equal(compact.time.totals[period], full.time.totals[period]);
    }
    assert.equal(compact.time.estimatedTotal, full.time.estimatedTotal);
    assert.equal(popupStatistics(compact), popupStatistics(full));
    assert.equal(Object.hasOwn(compact, "words"), false);
    assert.equal(Object.hasOwn(compact.time, "daily"), false);
  });
}

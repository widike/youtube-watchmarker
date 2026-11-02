import test from "node:test";
import assert from "node:assert/strict";
import { enrichHistoryVideos } from "../extension/history/history-video-statistics.js";
import { videoCard } from "../extension/ui/history-library.js";

const now = Date.now();
const id = "abcdefghijk";
const video = {
  strIdent: id,
  strTitle: "A title <with> markup",
  intTimestamp: now,
  entryId: `${id}:playback:session`,
  watchPrecision: "exact",
};
const row = (extra = {}) => ({
  strIdent: id,
  eventId: "playback:session",
  to: now,
  milliseconds: 60_000,
  ...extra,
});
const length = { strIdent: id, seconds: 600, expiresAt: now + 1000 };

test("statistics join the exact session and merge repeated, overlapping and skipped segments", () => {
  const [result] = enrichHistoryVideos(
    [video],
    [
      row({
        mediaRanges: [
          [0, 100],
          [300, 400],
        ],
      }),
      row({
        mediaRanges: [
          [50, 150],
          [350, 450],
        ],
      }),
      row({ eventId: "playback:other", mediaRanges: [[0, 600]] }),
      row({ strIdent: "another____", mediaRanges: [[0, 600]] }),
    ],
    [length],
    now,
  );
  assert.equal(result.durationSeconds, 600);
  assert.equal(result.watchedMilliseconds, 120_000);
  assert.equal(result.watchedPercent, 50);
});

test("imports and old time measurements do not invent completion percentages", () => {
  const [tracked, imported] = enrichHistoryVideos(
    [video, { ...video, entryId: `${id}:saved:${now}` }],
    [row()],
    [length],
    now,
  );
  assert.equal(tracked.watchedPercent, undefined);
  assert.equal(tracked.watchedMilliseconds, 60_000);
  assert.equal(imported.watchedMilliseconds, undefined);
  assert.equal(imported.durationSeconds, 600);
  assert.equal(imported.watchedPercent, undefined);
  assert.equal(
    enrichHistoryVideos([video], [], [{ ...length, expiresAt: now }], now)[0]
      .durationSeconds,
    undefined,
  );
});

test("player duration works without the optional duration cache and percentages stay bounded", () => {
  const [result] = enrichHistoryVideos(
    [video],
    [
      row({
        durationSeconds: 300,
        mediaRanges: [
          [0, 300],
          [0, 300],
        ],
      }),
    ],
    [],
    now,
  );
  assert.equal(result.durationSeconds, 300);
  assert.equal(result.watchedPercent, 100);
  const [incomplete] = enrichHistoryVideos(
    [video],
    [row(), row({ durationSeconds: 300, mediaRanges: [[0, 300]] })],
    [],
    now,
  );
  assert.equal(incomplete.watchedPercent, undefined);
});

test("cards omit missing statistics, filler labels and separate open controls", () => {
  const html = videoCard({ ...video, intTimestamp: 0 }, false, true, 0, 1);
  assert.doesNotMatch(
    html,
    /<time|video-meta|Saved watch|Watched again|video-open|unavailable|unknown|undefined|NaN/,
  );
  assert.match(html, /href="https:\/\/www.youtube.com\/watch\?v=abcdefghijk"/);
  assert.match(html, /A title &lt;with&gt; markup/);
  assert.match(html, /video-thumbnail/);
  const stats = videoCard(
    {
      ...video,
      durationSeconds: 600,
      watchedMilliseconds: 120_000,
      watchedPercent: 50,
    },
    false,
    true,
    0,
    1,
  );
  assert.match(stats, /<time/);
  assert.match(stats, /10:00/);
  assert.match(stats, /Watched: <\/span>2:00/);
  assert.match(stats, /50%<span class="visually-hidden"> watched/);
  assert.match(stats, /width:50%/);
});

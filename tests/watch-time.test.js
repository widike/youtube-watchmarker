import test from "node:test";
import assert from "node:assert/strict";
import { contentRuntime } from "./support/content-runtime.js";
import { summarizeHistory } from "../extension/history/history-statistics.js";
import { validateWatchTime } from "../extension/history/watch-time-storage.js";
import { DAY } from "../extension/statistics/statistics-dates.js";

const now = new Date(2026, 10, 1, 20).getTime();
const sessionId = "00000000-0000-4000-8000-000000000001";
const session = { videoId: "abcdefghijk", sessionId, title: "Space science" };
const sender = { tab: { id: 1 }, frameId: 0, documentId: "doc" };
const bucket = (from = now - 60_000, to = now, milliseconds = to - from) => ({
  minute: Math.floor(from / 60_000) * 60_000,
  from,
  to,
  milliseconds,
});

function setup(qualified = true) {
  const { watchmarker } = contentRuntime(["youtube/watch-time.js"]);
  let clock = now;
  const messages = [];
  const client = {
    send: async (message) => {
      messages.push(message);
      return { success: true };
    },
  };
  const meter = new watchmarker.WatchTimeTracker(client, () => clock);
  const player = {
    currentTime: 0,
    playbackRate: 1,
    readyState: 4,
    paused: false,
    seeking: false,
    ended: false,
  };
  return {
    session: { ...session, watchedMilliseconds: qualified ? 60_000 : 0 },
    meter,
    player,
    messages,
    client,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("video coverage follows media time at double speed and excludes seeking gaps", async () => {
  const { meter, player, advance, messages, session } = setup();
  player.duration = 600;
  player.playbackRate = 2;
  meter.observe(player, "playing", session);
  advance(5000);
  player.currentTime = 10;
  meter.observe(player, "timeupdate", session);
  await meter.flush();
  player.seeking = true;
  player.currentTime = 300;
  meter.observe(player, "seeking", session);
  player.seeking = false;
  meter.observe(player, "seeked", session);
  advance(5000);
  player.currentTime = 310;
  meter.observe(player, "timeupdate", session);
  await meter.flush();
  const bucket = messages.at(-1).buckets[0];
  assert.equal(bucket.milliseconds, 10_000);
  assert.equal(bucket.durationSeconds, 600);
  assert.deepEqual(JSON.parse(JSON.stringify(bucket.mediaRanges)), [
    [0, 10],
    [300, 310],
  ]);
  assert.doesNotThrow(() =>
    validateWatchTime(messages.at(-1), sender, now + 10_000),
  );
  bucket.mediaRanges = [[0, 601]];
  assert.throws(
    () => validateWatchTime(messages.at(-1), sender, now + 10_000),
    /coverage/,
  );
});

test("playback duration measures wall time at normal and double speed, excluding pauses and seeks", async () => {
  const { meter, player, advance, messages, session } = setup();
  meter.observe(player, "playing", session);
  advance(5000);
  player.currentTime = 5;
  meter.observe(player, "timeupdate", session);
  await meter.flush();
  assert.equal(messages.at(-1).buckets[0].milliseconds, 5000);
  player.playbackRate = 2;
  meter.observe(player, "ratechange", session);
  advance(5000);
  player.currentTime = 15;
  meter.observe(player, "timeupdate", session);
  player.paused = true;
  meter.observe(player, "pause", session);
  await meter.flush();
  assert.equal(messages.at(-1).buckets[0].milliseconds, 10_000);
  advance(5000);
  player.currentTime = 15;
  meter.observe(player, "timeupdate", session);
  player.paused = false;
  player.seeking = true;
  player.currentTime = 600;
  meter.observe(player, "seeking", session);
  player.seeking = false;
  meter.observe(player, "seeked", session);
  advance(1000);
  player.currentTime = 602;
  meter.observe(player, "timeupdate", session);
  await meter.flush();
  assert.equal(messages.at(-1).buckets[0].milliseconds, 11_000);
});

test("stalls, sleep, navigation, and player replacements cannot accumulate fictitious duration", async () => {
  const { meter, player, advance, messages, session } = setup();
  meter.observe(player, "playing", session);
  advance(5000);
  meter.observe(player, "waiting", session);
  advance(5000);
  player.currentTime = 5;
  meter.observe(player, "playing", session);
  advance(60_000);
  player.currentTime = 65;
  meter.observe(player, "timeupdate", session);
  meter.reset();
  advance(5000);
  player.currentTime = 70;
  meter.observe(player, "timeupdate", session);
  await meter.flush();
  assert.equal(messages.length, 0);
});

test("minute boundaries split actual elapsed time and lost replies retain idempotent snapshots", async () => {
  const { meter, messages, client, session } = setup();
  meter.add(session, now - 2000, now + 3000, 5000);
  let failed = true;
  client.send = async (message) => {
    messages.push(message);
    if (failed) throw new Error("reply lost");
    return { success: true };
  };
  await meter.flush();
  assert.equal(meter.pending.size, 2);
  failed = false;
  await meter.flush();
  assert.equal(meter.pending.size, 0);
  assert.equal(messages[0].buckets[0].milliseconds, 2000);
  assert.equal(messages[1].buckets[0].milliseconds, 2000);
  assert.equal(messages[2].buckets[0].milliseconds, 3000);
  assert.equal(messages[0].sessionId, messages[1].sessionId);
});

test("sub-minute duration stays in memory, flushes in full at a minute, and is discarded on reset", async () => {
  const { meter, messages, session } = setup(false);
  meter.add(session, now, now + 30_000, 30_000);
  await meter.flush();
  assert.equal(messages.length, 0);
  meter.add(session, now + 30_000, now + 59_999, 29_999);
  await meter.flush();
  assert.equal(messages.length, 0);
  meter.add(session, now + 59_999, now + 60_000, 1);
  await meter.flush();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].watchedMilliseconds, 60_000);
  assert.equal(messages[0].buckets[0].milliseconds, 60_000);
  const short = {
    ...session,
    sessionId: "short-session",
    watchedMilliseconds: 0,
  };
  meter.add(short, now + 60_000, now + 90_000, 30_000);
  meter.reset(true);
  await meter.flush();
  assert.equal(messages.length, 1);
  assert.equal(meter.pending.size, 0);
  assert.ok(
    [...meter.snapshots.values()].every(({ session }) => session !== short),
  );
});

test("duration reports reject invalid intervals, subframes, and forged cumulative totals", () => {
  const request = {
    ...session,
    watchedMilliseconds: 60_000,
    buckets: [bucket()],
  };
  validateWatchTime(request, sender, now);
  for (const bad of [
    { ...request, sessionId: "invalid" },
    { ...request, watchedMilliseconds: 59_999 },
    { ...request, watchedMilliseconds: undefined },
    { ...request, watchedMilliseconds: Infinity },
    { ...request, buckets: [bucket(now - 60_000, now, 60_001)] },
    { ...request, buckets: [{ ...bucket(), minute: now + 60_000 }] },
    { ...request, buckets: [{ ...bucket(), from: now }] },
    { ...request, buckets: [] },
  ])
    assert.throws(
      () => validateWatchTime(bad, sender, now),
      /Invalid playback time/,
    );
  for (const badSender of [
    { ...sender, frameId: 2, documentLifecycle: "active" },
    { ...sender, frameId: 2, documentLifecycle: "prerender" },
    { ...sender, frameId: 2, documentLifecycle: "cached", documentId: "" },
  ])
    assert.throws(
      () => validateWatchTime(request, badSender, now),
      /Invalid playback time report/,
    );
});

test("duration aggregates periods, local day/hour buckets, deleted videos, and counts independently", () => {
  const rows = [
    { ...bucket(), strIdent: "abcdefghijk" },
    { ...bucket(now - DAY - 60_000, now - DAY), strIdent: "abcdefghijk" },
    { ...bucket(), strIdent: "deleted____" },
  ];
  const stats = summarizeHistory(
    [
      {
        strIdent: "deleted____",
        intDeletedAt: now,
        intTimestamp: now - 1,
        watchEvents: [],
      },
    ],
    { period: "day", now, time: rows },
  );
  assert.equal(stats.selected, 0);
  assert.equal(stats.time.selected, 1 / 60);
  assert.equal(stats.time.previous, 1 / 60);
  assert.equal(stats.time.totals.all, 2 / 60);
  assert.equal(
    stats.time.averageWeek.reduce((sum, { count }) => sum + count, 0),
    1 / 60,
  );
  const noTime = summarizeHistory([], { now });
  assert.equal(noTime.time.first, null);
  assert.equal(noTime.time.selected, 0);
});

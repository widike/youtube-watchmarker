import assert from "node:assert/strict";
import test from "node:test";
import { contentRuntime } from "../support/content-runtime.js";

function setup() {
  const runtime = contentRuntime([
    "youtube/watch-time.js",
    "youtube/playback.js",
  ]);
  const messages = [];
  const marks = [];
  let now = 1_800_000_000_000;
  const tracker = new runtime.watchmarker.PlaybackTracker(
    {
      send: async (message) => {
        messages.push(message);
        return {
          success: true,
          data: { strIdent: message.videoId, intTimestamp: 100, intCount: 3 },
        };
      },
    },
    { updateWatchState: (...args) => marks.push(args) },
  );
  tracker.watchTime.clock = () => now;
  const player = {
    tagName: "VIDEO",
    currentTime: 0,
    duration: 600,
    playbackRate: 1,
    readyState: 4,
    paused: false,
    ended: false,
    seeking: false,
    closest: (selector) => (selector.startsWith("#movie_player") ? {} : null),
  };
  const emit = async (type) => {
    tracker.handlePlayerEvent({ type, target: player });
    await new Promise(setImmediate);
  };
  const watch = async (milliseconds) => {
    for (let remaining = milliseconds; remaining > 0; ) {
      const step = Math.min(10_000, remaining);
      now += step;
      player.currentTime += (step / 1000) * player.playbackRate;
      await emit("timeupdate");
      remaining -= step;
    }
  };
  return {
    ...runtime,
    tracker,
    messages,
    marks,
    player,
    emit,
    watch,
    elapse: (ms) => (now += ms),
    reports: () => messages.filter(({ action }) => action === "youtube-watch"),
  };
}

test("opening, rating, and 59.999 seconds save nothing; 60 seconds records once", async () => {
  const { tracker, emit, watch, reports, messages, marks } = setup();
  await tracker.report("navigation");
  await tracker.report("rating");
  await emit("playing");
  await watch(59_999);
  assert.equal(messages.length, 0);
  assert.equal(marks.length, 0);
  await watch(1);
  assert.equal(reports().length, 3);
  assert.equal(new Set(reports().map(({ sessionId }) => sessionId)).size, 1);
  assert.ok(
    reports().every(
      ({ watchedMilliseconds }) => watchedMilliseconds === 60_000,
    ),
  );
  assert.deepEqual(marks[0], ["aaaaaaaaaaa", 100, 3]);
  assert.equal(
    messages.filter(({ action }) => action === "youtube-watch-time").length,
    1,
  );
  await watch(10_000);
  assert.equal(reports().length, 3);
});

test("title changes reuse the qualified playback ID", async () => {
  const { tracker, emit, watch, reports, document } = setup();
  await tracker.report("navigation");
  await emit("playing");
  await watch(60_000);
  document.title = "New &amp; title - YouTube";
  await tracker.report("navigation");
  assert.equal(new Set(reports().map(({ sessionId }) => sessionId)).size, 1);
  assert.equal(reports().at(-1).title, "New &amp; title");
});

test("late titles reach both watch reports and watch-time snapshots", async () => {
  const { document, emit, watch, reports, messages, tracker } = setup();
  document.title = "YouTube";
  await emit("playing");
  assert.equal(tracker.session.title, "");
  await watch(30_000);
  document.title = "The actual title 😀 - YouTube";
  await watch(30_000);
  assert.equal(reports()[0].title, "The actual title 😀");
  assert.ok(
    messages
      .filter(({ action }) => action === "youtube-watch-time")
      .every(({ title }) => title === "The actual title 😀"),
  );
  document.title = "YouTube";
  await watch(20_000);
  assert.equal(tracker.session.title, "The actual title 😀");
  assert.equal(reports().at(-1).title, "The actual title 😀");
});

test("an ad interruption preserves actual viewing without counting ad time", async () => {
  const { tracker, player, emit, watch, messages, reports } = setup();
  await emit("playing");
  await watch(30_000);
  const closest = player.closest;
  player.closest = () => ({});
  await watch(60_000);
  assert.equal(messages.length, 0);
  player.closest = closest;
  await emit("playing");
  await watch(30_000);
  assert.equal(reports()[0].watchedMilliseconds, 60_000);
  const measured = messages.filter(
    ({ action }) => action === "youtube-watch-time",
  );
  assert.equal(
    measured.reduce((sum, { buckets }) => sum + buckets[0].milliseconds, 0),
    60_000,
  );
  assert.equal(tracker.session.watchedMilliseconds, 60_000);
});

test("seeking past a minute and double-speed media progress cannot bypass wall time", async () => {
  const { player, tracker, emit, watch, messages, reports } = setup();
  await emit("playing");
  player.seeking = true;
  player.currentTime = 600;
  await emit("seeking");
  player.seeking = false;
  player.playbackRate = 2;
  await emit("seeked");
  await watch(30_000);
  assert.equal(messages.length, 0);
  await watch(30_000);
  assert.equal(reports().length, 1);
  assert.equal(tracker.session.watchedMilliseconds, 60_000);
});

test("pauses, stalls and sleep do not qualify, while resumed viewing accumulates", async () => {
  const { player, emit, watch, elapse, reports, messages } = setup();
  await emit("playing");
  await watch(20_000);
  player.paused = true;
  await emit("pause");
  elapse(120_000);
  await emit("timeupdate");
  player.paused = false;
  await emit("playing");
  await emit("waiting");
  elapse(120_000);
  await emit("playing");
  elapse(60_000);
  player.currentTime += 60;
  await emit("timeupdate");
  assert.equal(messages.length, 0);
  await watch(40_000);
  assert.equal(reports().length, 1);
});

test("navigation discards unqualified time and suppresses stale events", async () => {
  const { tracker, player, emit, watch, window, listeners, messages, reports } =
    setup();
  tracker.initialize();
  await emit("playing");
  await watch(50_000);
  listeners.get("yt-navigate-start")();
  await watch(10_000);
  assert.equal(messages.length, 0);
  window.location.href = "https://www.youtube.com/shorts/bbbbbbbbbbb";
  listeners.get("yt-navigate-finish")();
  assert.equal(tracker.watchTime.pending.size, 0);
  player.currentTime = 0;
  await emit("playing");
  await watch(59_000);
  assert.equal(messages.length, 0);
  await watch(1000);
  assert.ok(reports().every(({ videoId }) => videoId === "bbbbbbbbbbb"));
});

test("short completed videos and repeated short loops never record a watch", async () => {
  const { player, emit, watch, messages } = setup();
  player.duration = 20;
  await emit("playing");
  await watch(20_000);
  player.ended = true;
  await emit("ended");
  player.ended = false;
  player.currentTime = 0;
  player.loop = true;
  await emit("playing");
  for (let loop = 0; loop < 4; loop++) {
    await watch(20_000);
    player.currentTime = 0;
    await emit("timeupdate");
  }
  assert.equal(messages.length, 0);
});

test("the final ended interval qualifies a full minute and replay starts from zero", async () => {
  const { player, emit, watch, elapse, reports } = setup();
  await emit("playing");
  await watch(59_000);
  elapse(1000);
  player.currentTime = 60;
  player.ended = true;
  await emit("ended");
  assert.equal(reports().length, 1);
  const first = reports()[0].sessionId;
  player.ended = false;
  player.currentTime = 0;
  await emit("playing");
  await watch(59_000);
  assert.equal(reports().length, 1);
  await watch(1000);
  assert.equal(reports().length, 2);
  assert.notEqual(first, reports()[1].sessionId);
});

test("ads, previews and inactive Shorts cannot accumulate viewing time", async () => {
  const { tracker, player, watch, messages } = setup();
  for (const closest of [
    () => null,
    () => ({}),
    (selector) =>
      selector === "ytd-reel-video-renderer"
        ? { hasAttribute: () => false }
        : null,
  ]) {
    player.closest = closest;
    tracker.handlePlayerEvent({ type: "playing", target: player });
    await watch(70_000);
  }
  assert.equal(messages.length, 0);
});

test("same-video URL changes retain time; leaving and returning requires a new minute", async () => {
  const { tracker, window, emit, watch, reports } = setup();
  await emit("playing");
  await watch(30_000);
  window.location.href =
    "https://www.youtube.com/watch?list=test&v=aaaaaaaaaaa&t=10";
  tracker.refresh();
  await watch(30_000);
  const first = reports()[0].sessionId;
  window.location.href = "https://www.youtube.com/feed/subscriptions";
  tracker.refresh();
  window.location.href = "https://www.youtube.com/watch?v=aaaaaaaaaaa";
  tracker.refresh();
  await emit("playing");
  await watch(59_000);
  assert.ok(reports().every(({ sessionId }) => sessionId === first));
  await watch(1000);
  assert.ok(reports().some(({ sessionId }) => sessionId !== first));
});

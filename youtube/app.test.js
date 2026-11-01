import assert from "node:assert/strict";
import test from "node:test";
import { contentRuntime, deferred } from "../test-support/content-runtime.js";

function appRuntime() {
  const runtime = contentRuntime(["youtube/app.js"]);
  const app = Object.create(
    runtime.watchmarker.YouTubeWatchmarkerApp.prototype,
  );
  app.isProcessing = false;
  app.playbackTracker = { refresh() {} };
  return { ...runtime, app };
}

test("same-sized replacement results still refresh thumbnails", async () => {
  const { watchmarker, app } = appRuntime();
  let current = ["first"];
  watchmarker.core.findVideos = () => current;
  const processed = [];
  app.videoMarkerManager = {
    processVideos: async (videos) => processed.push(videos),
  };
  await app.refresh();
  current = ["replacement"];
  await app.refresh();
  assert.deepEqual(processed, [["first"], ["replacement"]]);
});

test("watch broadcasts pass the saved count to thumbnails", () => {
  const { app, context } = appRuntime();
  let receive;
  context.chrome.runtime.onMessage = {
    addListener: (callback) => (receive = callback),
  };
  const marks = [];
  app.videoMarkerManager = {
    updateWatchState: (...args) => marks.push(args),
  };
  app.registerMessageListener();
  receive(
    {
      action: "youtube-mark",
      videoId: "aaaaaaaaaaa",
      timestamp: 200,
      count: 4,
    },
    {},
    () => {},
  );
  assert.deepEqual(marks, [["aaaaaaaaaaa", 200, 4]]);
});

test("a refresh arriving during a pending lookup runs after that lookup", async () => {
  const { watchmarker, app } = appRuntime();
  const first = deferred();
  let calls = 0;
  watchmarker.core.findVideos = () => [];
  app.videoMarkerManager = {
    processVideos: async () => {
      if (++calls === 1) await first.promise;
    },
  };
  const initial = app.refresh();
  await app.refresh();
  first.resolve();
  await initial;
  assert.equal(calls, 2);
  assert.equal(app.isProcessing, false);
});

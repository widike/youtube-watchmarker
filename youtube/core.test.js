import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = {
  location: {
    href: "https://www.youtube.com/feed/history",
    pathname: "/feed/history",
  },
};

globalThis.document = {
  querySelectorAll() {
    throw new Error("History pages must not query for videos to mark");
  },
};

await import("./core.js");

const { core } = globalThis.YouTubeWatchmarkerContent;

test("watch history routes are excluded from video marking", () => {
  assert.equal(core.isWatchHistoryPage(), true);
  assert.deepEqual(core.findVideos(), []);

  window.location.pathname = "/feed/history/";
  assert.equal(core.isWatchHistoryPage(), true);

  window.location.pathname = "/feed/history-search";
  assert.equal(core.isWatchHistoryPage(), false);
});

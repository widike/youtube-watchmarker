import assert from "node:assert/strict";
import test from "node:test";
import { contentRuntime } from "../support/content-runtime.js";

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

await import("../../extension/shared/video-identity.js");
await import("../../extension/youtube/core.js");

const { core } = globalThis.YouTubeWatchmarkerContent;

test("watch history routes are excluded from video marking", () => {
  assert.equal(core.isWatchHistoryPage(), true);
  assert.deepEqual(core.findVideos(), []);

  window.location.pathname = "/feed/history/";
  assert.equal(core.isWatchHistoryPage(), true);

  window.location.pathname = "/feed/history-search";
  assert.equal(core.isWatchHistoryPage(), false);
});

test("video IDs use exact URL components across YouTube routes and thumbnail formats", () => {
  for (const url of [
    "/watch?list=PL123&v=aB_cd-Ef012&t=5",
    "https://m.youtube.com/watch?v=aB_cd-Ef012#chapter",
    "https://www.youtube.com/shorts/aB_cd-Ef012?feature=share",
    "https://www.youtube.com/live/aB_cd-Ef012",
    "https://youtu.be/aB_cd-Ef012?t=4",
    "https://www.youtube.com/redirect?q=https%3A%2F%2Fyoutu.be%2FaB_cd-Ef012",
    "https://i.ytimg.com/vi/aB_cd-Ef012/hqdefault.jpg",
    "https://i.ytimg.com/vi_webp/aB_cd-Ef012/hqdefault.webp",
  ])
    assert.equal(core.extractVideoId(url), "aB_cd-Ef012", url);
  for (const url of [
    "https://www.youtube.com/watch?v=aB_cd-Ef012extra",
    "https://www.youtube.com/shorts/aB_cd-Ef012extra",
    "https://www.youtube.com/shorts/aB_cd-Ef012/extra",
    "https://www.youtube.com/feed/abcdefghijk",
    "https://www.youtube.com.evil.test/watch?v=aB_cd-Ef012",
    "https://example.test/?v=aB_cd-Ef012",
    "javascript:watch?v=aB_cd-Ef012",
  ])
    assert.equal(core.extractVideoId(url), null, url);
});

test("reused notification images follow the current link rather than stale image URLs", () => {
  const link = { href: "https://www.youtube.com/watch?v=bbbbbbbbbbb" };
  const image = {
    src: "https://i.ytimg.com/vi/aaaaaaaaaaa/default.jpg",
    closest: () => link,
  };
  assert.equal(core.extractVideoId(image), "bbbbbbbbbbb");
  link.href = "https://www.youtube.com/feed/subscriptions";
  assert.equal(core.extractVideoId(image), null);
});

test("watch titles use the metadata container even without heading style classes", () => {
  const { document, watchmarker } = contentRuntime();
  document.title = "YouTube";
  document.querySelector = (selector) =>
    selector === "ytd-watch-metadata h1"
      ? { textContent: "Grüße 😀 &amp; 東京" }
      : null;
  assert.equal(watchmarker.core.getCurrentVideoTitle(), "Grüße 😀 &amp; 東京");
});

test("head metadata must match the current video, and branding is never a title", () => {
  const { document, watchmarker } = contentRuntime();
  document.title = "YouTube";
  let metadataId = "bbbbbbbbbbb";
  document.querySelector = (selector) => {
    if (selector === 'meta[itemprop="videoId"]')
      return { getAttribute: () => metadataId };
    if (selector === 'meta[name="title"]')
      return { getAttribute: () => "Metadata title" };
    return null;
  };
  assert.equal(watchmarker.core.getCurrentVideoTitle(), "");
  metadataId = "aaaaaaaaaaa";
  assert.equal(watchmarker.core.getCurrentVideoTitle(), "Metadata title");
});

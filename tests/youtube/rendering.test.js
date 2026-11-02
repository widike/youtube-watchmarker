import assert from "node:assert/strict";
import test from "node:test";
import {
  contentRuntime,
  thumbnail,
  deferred,
} from "../support/content-runtime.js";

test("watched thumbnails are marked by ID and recycled cards lose stale marks", async () => {
  const { watchmarker, document } = contentRuntime(["youtube/rendering.js"]);
  const element = thumbnail();
  document.querySelectorAll = () => [element];
  const marker = new watchmarker.VideoMarkerManager({
    send: async () => ({ success: true, strIdent: null }),
  });
  marker.updateWatchState("aaaaaaaaaaa", 100, 3);
  assert.equal(element.classList.contains("youwatch-mark"), true);
  assert.ok(element.getAttribute("watchdate"));
  assert.equal(element.getAttribute("watchcount"), " ×3");
  element.href = "/watch?v=bbbbbbbbbbb";
  await marker.processVideos([element]);
  assert.equal(element.classList.contains("youwatch-mark"), false);
  assert.equal(element.getAttribute("watchdate"), undefined);
  assert.equal(element.getAttribute("watchcount"), undefined);
});

test("duplicate cards share one lookup and all current copies receive the mark", async () => {
  const { watchmarker, document } = contentRuntime(["youtube/rendering.js"]);
  const elements = [thumbnail(), thumbnail()];
  document.querySelectorAll = (selector) =>
    selector === ".youwatch-mark" ? [] : elements;
  let requests = 0;
  const response = deferred();
  const marker = new watchmarker.VideoMarkerManager({
    send: () => {
      requests++;
      return response.promise;
    },
  });
  const processing = marker.processVideos(elements);
  response.resolve({
    success: true,
    strIdent: "aaaaaaaaaaa",
    intTimestamp: 100,
    intCount: 4,
  });
  await processing;
  assert.equal(requests, 1);
  assert.ok(
    elements.every((element) => element.classList.contains("youwatch-mark")),
  );
  assert.ok(
    elements.every((element) => element.getAttribute("watchcount") === " ×4"),
  );
});

test("late lookups cannot restore invalidated history or mark a reused card", async () => {
  const { watchmarker, document } = contentRuntime(["youtube/rendering.js"]);
  const element = thumbnail();
  document.querySelectorAll = () => [element];
  const response = deferred();
  const marker = new watchmarker.VideoMarkerManager({
    send: () => response.promise,
  });
  const lookup = marker.requestVideoData("aaaaaaaaaaa");
  marker.invalidate();
  element.href = "/watch?v=bbbbbbbbbbb";
  response.resolve({
    success: true,
    strIdent: "aaaaaaaaaaa",
    intTimestamp: 100,
  });
  await lookup;
  assert.equal(marker.getWatchTimestamp("aaaaaaaaaaa"), null);
  assert.equal(element.classList.contains("youwatch-mark"), false);
});

test("failed or missing responses do not mark videos and can be retried", async () => {
  const { watchmarker } = contentRuntime(["youtube/rendering.js"]);
  let count = 0;
  const marker = new watchmarker.VideoMarkerManager({
    send: async () => {
      count++;
      return null;
    },
  });
  await marker.requestVideoData("aaaaaaaaaaa");
  await marker.requestVideoData("aaaaaaaaaaa");
  assert.equal(marker.getWatchTimestamp("aaaaaaaaaaa"), null);
  assert.equal(count, 2);
});

test("older lookup timestamps never replace a live playback update", async () => {
  const { watchmarker } = contentRuntime(["youtube/rendering.js"]);
  const response = deferred();
  const marker = new watchmarker.VideoMarkerManager({
    send: () => response.promise,
  });
  const lookup = marker.requestVideoData("aaaaaaaaaaa");
  marker.updateWatchState("aaaaaaaaaaa", 200, 5);
  response.resolve({
    success: true,
    strIdent: "aaaaaaaaaaa",
    intTimestamp: 100,
    intCount: 2,
  });
  await lookup;
  assert.equal(marker.getWatchTimestamp("aaaaaaaaaaa"), 200);
  const element = thumbnail();
  marker.markVideo(element, "aaaaaaaaaaa");
  assert.equal(element.getAttribute("watchcount"), " ×5");
});

test("watch counts update without a date and disappear when marks are cleared", () => {
  const { watchmarker, document, window } = contentRuntime([
    "youtube/rendering.js",
  ]);
  const element = thumbnail();
  document.querySelectorAll = () => [element];
  const marker = new watchmarker.VideoMarkerManager({});
  marker.updateWatchState("aaaaaaaaaaa", 0, 1);
  assert.equal(element.classList.contains("youwatch-mark"), true);
  assert.equal(element.getAttribute("watchcount"), undefined);
  marker.updateWatchState("aaaaaaaaaaa", 0, 2);
  assert.equal(element.getAttribute("watchcount"), " ×2");
  assert.equal(element.getAttribute("watchdate"), undefined);
  marker.updateWatchState("aaaaaaaaaaa", 100, 3);
  assert.equal(element.getAttribute("watchcount"), " ×3");
  assert.ok(element.getAttribute("watchdate"));
  marker.updateWatchState("bbbbbbbbbbb", 100, 1);
  element.href = "/watch?v=bbbbbbbbbbb";
  marker.markVideo(element, "bbbbbbbbbbb");
  assert.equal(element.classList.contains("youwatch-mark"), true);
  assert.equal(element.getAttribute("watchcount"), undefined);
  assert.ok(element.getAttribute("watchdate"));
  window.location.pathname = "/feed/history";
  marker.markVideo(element, "aaaaaaaaaaa");
  assert.equal(element.getAttribute("watchcount"), undefined);
  marker.updateWatchState("aaaaaaaaaaa", 100, 3);
  window.location.pathname = "/";
  marker.markVideo(element, "aaaaaaaaaaa");
  marker.clearMarks();
  assert.equal(element.getAttribute("watchcount"), undefined);
  assert.equal(element.getAttribute("watchdate"), undefined);
});

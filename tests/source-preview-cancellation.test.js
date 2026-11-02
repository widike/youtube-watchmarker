import assert from "node:assert/strict";
import test from "node:test";
import { History } from "../extension/sources/bg-history.js";
import { Youtube } from "../extension/sources/bg-youtube.js";
import {
  handleSourcePreview,
  handleSourcePreviewCancel,
} from "../extension/handlers/source-handlers.js";
import { searchBrowserHistory } from "../extension/sources/browser-history-search.js";
import { summarizeSource } from "../extension/sources/source-preview.js";
import { synchronizeYouTubeSource } from "../extension/sources/youtube-source-sync.js";
import { requestYouTubeApi } from "../extension/sources/youtube-request.js";

function mockChrome(t, value) {
  const previous = globalThis.chrome;
  globalThis.chrome = value;
  t.after(() => {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  });
}

test("cancelling a source check stops its three scans and leaves other pages running", async (t) => {
  const signals = [];
  const scan = ({ signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
      // Let the independent page finish without cancellation.
      if (signals.length >= 4) resolve({ totalCount: 0 });
    });
  };
  t.mock.method(History, "preview", scan);
  t.mock.method(Youtube, "previewHistory", scan);
  t.mock.method(Youtube, "previewLikedVideos", scan);
  const requests = ["history", "youtube", "likes"].map((source) =>
    handleSourcePreview({ source, requestId: "first-page" }),
  );
  const otherPage = handleSourcePreview({
    source: "youtube",
    requestId: "other-page",
  });
  assert.equal(
    (await handleSourcePreviewCancel({ requestId: "first-page" })).success,
    true,
  );
  for (const response of await Promise.all(requests)) {
    assert.deepEqual(response, { success: true, cancelled: true });
  }
  assert.deepEqual(
    signals.map((signal) => signal.aborted),
    [true, true, true, false],
  );
  assert.equal((await otherPage).success, true);
  assert.equal(
    (await handleSourcePreview({ source: "youtube", requestId: "retry" }))
      .success,
    true,
  );
});

test("browser history cancellation stops pagination after the current Chrome call", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  mockChrome(t, {
    history: {
      search: async () => {
        calls++;
        controller.abort();
        return Array.from({ length: 1000 }, () => ({}));
      },
    },
  });
  const scan = searchBrowserHistory(0, Date.now(), {
    signal: controller.signal,
  });
  await assert.rejects(scan.next(), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("cancelling the saved count prevents further database batches", async () => {
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(
    summarizeSource(
      Array.from({ length: 250 }, (_, i) => i),
      {
        getVideo: async () => {
          reads++;
          controller.abort();
          return null;
        },
      },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  );
  assert.equal(reads, 100);
});

test("YouTube preview cancellation aborts its active page fetch", async (t) => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    started();
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  const scan = synchronizeYouTubeSource({ getProvider: () => ({}) }, null, {
    url: "https://www.youtube.com/feed/history",
    label: "YouTube history",
    parsePage: () => {
      throw new Error("Cancelled fetch must not be parsed");
    },
    preview: true,
    signal: controller.signal,
  });
  await ready;
  controller.abort();
  await assert.rejects(scan, { name: "AbortError" });
});

test("YouTube continuation cancellation aborts the request after authentication", async (t) => {
  const controller = new AbortController();
  mockChrome(t, {
    runtime: { id: "test-extension" },
    cookies: {
      get: (_options, callback) => callback({ value: "test-cookie" }),
    },
    declarativeNetRequest: { updateSessionRules: async () => {} },
  });
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    started();
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  const scan = requestYouTubeApi(
    "browse",
    { apiKey: "test-key", context: {} },
    { continuation: "next-page" },
    { signal: controller.signal },
  );
  await ready;
  controller.abort();
  await assert.rejects(scan, { name: "AbortError" });
});

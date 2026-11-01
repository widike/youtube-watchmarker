import assert from "node:assert/strict";
import test from "node:test";
import { withWatchmarkerRefresh } from "./watch-notifications.js";

test("imports refresh thumbnails even when only partially successful", async (t) => {
  const oldChrome = globalThis.chrome;
  t.after(() => {
    globalThis.chrome = oldChrome;
  });
  const messages = [];
  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (_id, message) => messages.push(message),
    },
  };
  await assert.rejects(
    withWatchmarkerRefresh(async () => {
      throw new Error("Partial import");
    }),
    /Partial import/,
  );
  assert.deepEqual(messages, [{ action: "youtube-refresh" }]);
  await withWatchmarkerRefresh(async () => ({ downloaded: 0 }));
  assert.equal(messages.length, 1);
  await withWatchmarkerRefresh(async () => ({ downloaded: 4 }));
  assert.equal(messages.length, 2);
});

test("missing content scripts do not turn a saved watch into a failure", async (t) => {
  const oldChrome = globalThis.chrome;
  t.after(() => {
    globalThis.chrome = oldChrome;
  });
  globalThis.chrome = {
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async () => {
        throw new Error("No receiving end");
      },
    },
  };
  assert.equal(await withWatchmarkerRefresh(async () => "saved"), "saved");
});

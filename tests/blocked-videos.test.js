import assert from "node:assert/strict";
import test from "node:test";
import {
  BlockedVideoStore,
  BLOCKED_VIDEOS_KEY,
} from "../extension/background/blocked-videos.js";

test("local blocks survive restarts and concurrent edits without changing watch history", async () => {
  const data = { history: ["untouched"] };
  const storage = {
    get: async () => structuredClone(data),
    set: async (values) => Object.assign(data, structuredClone(values)),
  };
  const store = new BlockedVideoStore(storage);
  await Promise.all([
    store.update("aaaaaaaaaaa", "First", true),
    store.update("bbbbbbbbbbb", "Second", true),
    store.update("aaaaaaaaaaa", "", false),
    store.update("ccccccccccc", "<img onerror=alert(1)> Grüße 😀", true),
  ]);
  const videos = await new BlockedVideoStore(storage).list();
  assert.deepEqual(
    videos.map((video) => video.videoId),
    ["ccccccccccc", "bbbbbbbbbbb"],
  );
  assert.equal(videos[0].title, "<img onerror=alert(1)> Grüße 😀");
  assert.ok(videos[0].updatedAt > 0);
  assert.deepEqual(data.history, ["untouched"]);
  assert.deepEqual(
    Object.keys(data).sort(),
    ["history", BLOCKED_VIDEOS_KEY].sort(),
  );
});

test("a failed block stays unsaved and the next write can succeed", async () => {
  const data = {};
  let fail = true;
  const store = new BlockedVideoStore({
    get: async () => structuredClone(data),
    set: async (values) => {
      if (fail) throw new Error("Disk full");
      Object.assign(data, values);
    },
  });
  await assert.rejects(store.update("aaaaaaaaaaa", "First", true), /Disk full/);
  assert.deepEqual(await store.list(), []);
  fail = false;
  await store.update("bbbbbbbbbbb", "Second", true);
  assert.equal((await store.list()).length, 1);
  assert.throws(() => store.update("invalid", "Invalid", true), /Invalid/);
});

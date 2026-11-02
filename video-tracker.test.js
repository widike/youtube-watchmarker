import assert from "node:assert/strict";
import test from "node:test";
import { VideoTracker } from "./video-tracker.js";
import { YoutubeManager } from "./bg-youtube.js";
import { memoryHistory } from "./test-support/memory-history.js";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const event = (reason, sessionId = first) => ({
  videoId: "aaaaaaaaaaa",
  title: "Grüße 😀 &amp; 東京",
  reason,
  sessionId,
  watchedMilliseconds: 60_000,
});
const sender = (id = 1) => ({
  tab: { id },
  url: "https://www.youtube.com/watch?list=test&v=aaaaaaaaaaa",
  frameId: 0,
  documentId: "doc",
});

async function setup(t, settings = {}) {
  const messages = [];
  const oldChrome = globalThis.chrome;
  t.after(() => {
    globalThis.chrome = oldChrome;
  });
  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => ({
          idCondition_Brownav: true,
          idCondition_Youprog: true,
          idCondition_Yourating: true,
          ...settings,
        }),
      },
      session: {
        get: async () => {
          throw new Error("Playback must use atomic IndexedDB receipts");
        },
        set: async () => {
          throw new Error("Playback must use atomic IndexedDB receipts");
        },
      },
    },
    tabs: {
      onRemoved: { addListener() {} },
      query: async () => [{ id: 1 }, { id: 2 }],
      sendMessage: async (id, message) => messages.push({ id, ...message }),
    },
  };
  const manager = new YoutubeManager();
  const { provider } = memoryHistory();
  manager.setProviderFactory({ getCurrentProvider: () => provider });
  const tracker = new VideoTracker();
  await tracker.initialize(manager);
  return { tracker, manager, messages, provider };
}

test("every live detector ignores missing or sub-minute playback time", async (t) => {
  const { tracker, manager, messages } = await setup(t);
  for (const reason of ["navigation", "progress", "rating"]) {
    for (const watchedMilliseconds of [
      undefined,
      null,
      -1,
      0,
      59_999,
      "60000",
      NaN,
      Infinity,
    ]) {
      assert.equal(
        await tracker.recordWatch(
          { ...event(reason), watchedMilliseconds },
          sender(),
        ),
        null,
      );
    }
  }
  assert.equal(await manager.lookup("aaaaaaaaaaa"), null);
  assert.equal(messages.length, 0);
  await tracker.recordWatch(event("progress"), sender());
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 1);
  await tracker.recordWatch(
    { ...event("progress", second), watchedMilliseconds: 59_999 },
    sender(),
  );
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 1);
});

test("navigation, progress, ratings and title changes count one play", async (t) => {
  const { tracker, manager, messages } = await setup(t);
  await Promise.all(
    ["navigation", "progress", "rating", "progress"].map((reason) =>
      tracker.recordWatch(event(reason), sender()),
    ),
  );
  const video = await manager.lookup("aaaaaaaaaaa");
  assert.equal(video.intCount, 1);
  assert.equal(video.strTitle, "Grüße 😀 &amp; 東京");
  assert.equal(messages.at(-1).timestamp, video.intTimestamp);
  assert.equal(messages.at(-1).count, 1);
});

test("repeat play, parallel tabs and delayed retries retain exact counts", async (t) => {
  const { tracker, manager } = await setup(t);
  await tracker.recordWatch(event("navigation"), sender());
  await Promise.all([
    tracker.recordWatch(event("progress", second), sender()),
    tracker.recordWatch(event("progress"), sender(2)),
  ]);
  await tracker.recordWatch(event("progress"), sender());
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 3);
});

test("worker restart retains deduplication state", async (t) => {
  const { tracker, manager } = await setup(t);
  await tracker.recordWatch(event("navigation"), sender());
  const restarted = new VideoTracker();
  await restarted.initialize(manager);
  await restarted.recordWatch(event("progress"), sender());
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 1);
});

test("disabled navigation allows enabled progress to record the first play", async (t) => {
  const { tracker, manager } = await setup(t, {
    idCondition_Brownav: false,
    idCondition_Yourating: false,
  });
  assert.equal(await tracker.recordWatch(event("navigation"), sender()), null);
  assert.equal(await manager.lookup("aaaaaaaaaaa"), null);
  await tracker.recordWatch(event("progress"), sender());
  await tracker.recordWatch(event("rating", second), sender());
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 1);
});

test("malformed, mismatched and subframe watch events are rejected", async (t) => {
  const { tracker } = await setup(t);
  await assert.rejects(
    tracker.recordWatch({ ...event("progress"), sessionId: "bad" }, sender()),
    /Invalid watch event/,
  );
  await assert.rejects(
    tracker.recordWatch(
      { ...event("progress"), videoId: "bbbbbbbbbbb" },
      sender(),
    ),
    /Invalid watch event/,
  );
  await assert.rejects(
    tracker.recordWatch(event("progress"), { ...sender(), frameId: 2 }),
    /Invalid watch event/,
  );
});

test("a missing content title falls back to the sender tab without adding a view", async (t) => {
  const { tracker, manager } = await setup(t);
  const tabSender = {
    ...sender(),
    tab: { id: 1, url: sender().url, title: "Recovered Grüße 😀 - YouTube" },
  };
  for (const title of ["", "YouTube", "Untitled video"]) {
    await tracker.recordWatch({ ...event("progress"), title }, tabSender);
    const video = await manager.lookup("aaaaaaaaaaa");
    assert.equal(video.strTitle, "Recovered Grüße 😀");
    assert.equal(video.intCount, 1);
  }
});

test("missing live titles are recovered from history after recording a qualified watch", async (t) => {
  const { tracker, manager, provider } = await setup(t);
  chrome.history = {
    search: async () => [
      {
        url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        title: "Recovered from history - YouTube",
      },
    ],
  };
  provider.repairVideoTitle = async (videoId, title) => {
    const video = await provider.getVideo(videoId);
    assert.equal(video.intCount, 1);
    await provider.putVideo({ ...video, strTitle: title });
    return title;
  };
  const report = { ...event("progress"), videoId: "bbbbbbbbbbb", title: "" };
  const source = {
    ...sender(),
    url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
  };
  const video = await tracker.recordWatch(report, source);
  assert.equal(video.strTitle, "Recovered from history");
  await tracker.recordWatch(report, source);
  assert.equal((await manager.lookup("bbbbbbbbbbb")).intCount, 1);
});

test("a tab that navigated ahead cannot supply another video's title", async (t) => {
  const { tracker, manager } = await setup(t);
  await tracker.recordWatch(event("progress"), sender());
  await tracker.recordWatch(
    { ...event("progress"), title: "" },
    {
      ...sender(),
      tab: {
        id: 1,
        url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        title: "Another video - YouTube",
      },
    },
  );
  const saved = await manager.lookup("aaaaaaaaaaa");
  assert.equal(saved.strTitle, event("progress").title);
  assert.equal(saved.intCount, 1);
});

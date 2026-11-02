import assert from "node:assert/strict";
import test from "node:test";
import {
  VideoTitleRecovery,
  videoTitleRecovery,
} from "./video-title-recovery.js";
import { SearchManager } from "./bg-search.js";

const id = "aaaaaaaaaaa";

function history(t, items) {
  const previous = globalThis.chrome;
  t.after(() => {
    globalThis.chrome = previous;
  });
  const queries = [];
  globalThis.chrome = {
    history: {
      search: async (query) => {
        queries.push(query);
        return items;
      },
    },
  };
  return queries;
}

test("recovery uses an exact video URL and a useful title, never visit counts", async (t) => {
  const queries = history(t, [
    {
      url: `https://example.test/?v=${id}`,
      title: "Wrong site",
      lastVisitTime: 30,
    },
    {
      url: `https://www.youtube.com/watch?v=bbbbbbbbbbb&list=${id}`,
      title: "Wrong video",
      lastVisitTime: 20,
    },
    {
      url: `https://www.youtube.com/watch?v=${id}`,
      title: "YouTube",
      lastVisitTime: 10,
    },
    {
      url: `https://www.youtube.com/watch?v=${id}&t=3`,
      title: "Grüße 😀 &amp; - YouTube",
      lastVisitTime: 5,
      visitCount: 100,
    },
  ]);
  const recovery = new VideoTitleRecovery();
  assert.equal(await recovery.find(id), "Grüße 😀 &amp;");
  assert.deepEqual(queries, [{ text: id, startTime: 0, maxResults: 100 }]);
});

test("missing and failing history queries are throttled and never block playback", async (t) => {
  const queries = history(t, []);
  const recovery = new VideoTitleRecovery();
  await Promise.all([recovery.find(id), recovery.find(id)]);
  assert.equal(queries.length, 1);
  assert.equal(await recovery.find(id), "");
  assert.equal(queries.length, 1);
  chrome.history.search = async () => {
    throw new Error("Unavailable");
  };
  assert.equal(await recovery.find("bbbbbbbbbbb"), "");
});

test("opening history repairs missing titles before title search and preserves activity", async (t) => {
  history(t, [
    {
      url: `https://www.youtube.com/watch?v=${id}`,
      title: "Restored title - YouTube",
    },
  ]);
  const original = {
    strIdent: id,
    strTitle: "",
    intTimestamp: 100,
    intCount: 1,
    intImportedCount: 0,
    watchEvents: [
      { eventId: "playback:session", source: "playback", watchedAt: 100 },
    ],
  };
  let stored = structuredClone(original);
  const repairs = [];
  const provider = {
    getAllVideos: async () => [structuredClone(stored)],
    repairVideoTitle: async (videoId, title) => {
      repairs.push(videoId);
      stored.strTitle = title;
      return title;
    },
  };
  const search = new SearchManager();
  search.setProviderFactory({ getCurrentProvider: () => provider });
  videoTitleRecovery.retryAfter.delete(id);
  const result = await search.lookup("Restored");
  assert.equal(result.totalResults, 1);
  assert.equal(result.videos[0].strTitle, "Restored title");
  assert.deepEqual(stored, { ...original, strTitle: "Restored title" });
  await search.lookup();
  assert.deepEqual(repairs, [id]);
});

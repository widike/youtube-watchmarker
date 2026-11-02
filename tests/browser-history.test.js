import assert from "node:assert/strict";
import test from "node:test";
import { HistoryManager } from "../extension/sources/bg-history.js";
import { normalizeVideo } from "../extension/history/history-records.js";

const row = (id, overrides = {}) => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  title: "A history video - YouTube",
  lastVisitTime: 2000,
  visitCount: 2,
  ...overrides,
});

function setup(
  t,
  rows,
  existing = [],
  { failVideo = null, failSearch = false } = {},
) {
  const records = new Map(existing.map((v) => [v.strIdent, v]));
  const searches = [];
  const writes = [];
  const oldChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: {},
    history: {
      search(query, cb) {
        searches.push(query);
        if (failSearch) {
          chrome.runtime.lastError = { message: "History permission denied" };
          cb?.();
          delete chrome.runtime.lastError;
          return Promise.reject(new Error("History permission denied")).catch(
            (error) => {
              if (!cb) throw error;
            },
          );
        }
        const matches = rows
          .filter(
            (r) =>
              (!query.text || `${r.url} ${r.title}`.includes(query.text)) &&
              (!Number.isFinite(r.lastVisitTime) ||
                r.lastVisitTime >= query.startTime) &&
              (!Number.isFinite(r.lastVisitTime) ||
                r.lastVisitTime < (query.endTime ?? Infinity)),
          )
          .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
          .slice(0, query.maxResults);
        cb?.(matches);
        return Promise.resolve(matches);
      },
    },
  };
  t.after(() => {
    globalThis.chrome = oldChrome;
  });
  const manager = new HistoryManager();
  manager.setProviderFactory({
    getCurrentProvider: () => ({
      getVideo: async (id) => records.get(id),
      putVideo: async (v) => {
        if (v.strIdent === failVideo) throw new Error("Database write failed");
        writes.push(v);
        records.set(v.strIdent, v);
      },
    }),
  });
  return { manager, records, searches, writes };
}

test("video URL parsing handles query order, mobile Shorts, bare hosts and short links", () => {
  const manager = new HistoryManager();
  for (const url of [
    "https://www.youtube.com/watch?list=PL123&v=aaaaaaaaaaa&t=3",
    "https://m.youtube.com/shorts/aaaaaaaaaaa?feature=share",
    "http://youtube.com/watch?v=aaaaaaaaaaa",
    "https://youtu.be/aaaaaaaaaaa?t=3",
    "https://music.youtube.com/watch?v=aaaaaaaaaaa",
  ])
    assert.equal(manager.extractVideoId(url), "aaaaaaaaaaa", url);
  for (const url of [
    undefined,
    "garbage",
    "https://youtube.com.evil.test/watch?v=aaaaaaaaaaa",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/playlist?list=aaaaaaaaaaa",
  ])
    assert.equal(manager.isYouTubeVideoUrl(url), false);
});

test("missing titles do not exclude known video IDs from history", async (t) => {
  const { manager, records } = setup(t, [
    row("aaaaaaaaaaa", { title: undefined }),
  ]);
  assert.equal((await manager.synchronize()).newCount, 1);
  assert.equal(records.get("aaaaaaaaaaa").strTitle, "");
});

test("deleted-video page titles neither replace saved titles nor become metadata", async (t) => {
  const { manager, records } = setup(
    t,
    [
      row("aaaaaaaaaaa", { title: "- YouTube" }),
      row("bbbbbbbbbbb", { title: "- YouTube" }),
    ],
    [
      {
        strIdent: "aaaaaaaaaaa",
        strTitle: "Original title",
        intTimestamp: 1000,
        intCount: 2,
      },
    ],
  );
  await manager.synchronize();
  assert.equal(records.get("aaaaaaaaaaa").strTitle, "Original title");
  assert.equal(records.get("aaaaaaaaaaa").intTimestamp, 2000);
  assert.equal(records.get("bbbbbbbbbbb").strTitle, "");
});

test("browser preview counts unique importable videos and never writes", async (t) => {
  const known = {
    strIdent: "aaaaaaaaaaa",
    strTitle: "Saved",
    intTimestamp: 1000,
  };
  const { manager, writes, records } = setup(
    t,
    [
      row("aaaaaaaaaaa"),
      row("aaaaaaaaaaa", { url: "https://youtu.be/aaaaaaaaaaa" }),
      row("bbbbbbbbbbb"),
      row("ccccccccccc", { lastVisitTime: undefined }),
      row("ddddddddddd", {
        url: "https://youtube.com/playlist?list=ddddddddddd",
      }),
    ],
    [known],
  );
  assert.partialDeepStrictEqual(await manager.preview(), {
    totalCount: 2,
    existingCount: 1,
    newCount: 1,
    unknownTimestampCount: 1,
  });
  assert.deepEqual(writes, []);
  assert.deepEqual([...records.values()], [known]);
  assert.equal((await manager.synchronize()).newCount, 1);
  assert.equal((await manager.preview()).newCount, 0);
});

test("URL variants merge once using the latest visit and a meaningful title", async (t) => {
  const { manager, records, writes } = setup(t, [
    row("aaaaaaaaaaa", {
      lastVisitTime: 3000,
      title: "YouTube",
      visitCount: 4,
    }),
    row("aaaaaaaaaaa", {
      url: "https://youtu.be/aaaaaaaaaaa",
      lastVisitTime: 2000,
    }),
    row("aaaaaaaaaaa", {
      url: "https://m.youtube.com/shorts/aaaaaaaaaaa",
      lastVisitTime: 1000,
    }),
  ]);
  const result = await manager.synchronize(0, true);
  assert.equal(result.newCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.equal(writes.length, 1);
  assert.partialDeepStrictEqual(records.get("aaaaaaaaaaa"), {
    strIdent: "aaaaaaaaaaa",
    strTitle: "A history video",
    intTimestamp: 3000,
    intCount: 4,
  });
});

test("browser imports skip timestamps already recorded by playback", async (t) => {
  const existing = normalizeVideo({
    strIdent: "aaaaaaaaaaa",
    strTitle: "A history video",
    intTimestamp: 3000,
    intImportedCount: 0,
    watchEvents: [2000, 3000].map((watchedAt) => ({
      eventId: `play:${watchedAt}`,
      watchedAt,
      source: "playback",
      precision: "exact",
    })),
  });
  const { manager, records, writes } = setup(
    t,
    [row("aaaaaaaaaaa")],
    [existing],
  );
  const result = await manager.synchronize();
  assert.equal(result.updatedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(records.get("aaaaaaaaaaa"), existing);
});

test("large history is searched in bounded ranges without losing tied timestamps", async (t) => {
  const rows = Array.from({ length: 2500 }, (_, i) =>
    row(String(i).padStart(11, "0"), {
      lastVisitTime: 1000 + Math.floor(i / 10),
    }),
  );
  const { manager, records, searches } = setup(t, rows);
  const result = await manager.synchronize();
  assert.equal(result.newCount, rows.length);
  assert.equal(records.size, rows.length);
  assert.ok(searches.length > 2);
  assert.ok(searches.every((query) => query.maxResults <= 10000));
});

test("one failed database write does not block remaining history and fails the import", async (t) => {
  const { manager, records } = setup(
    t,
    [row("aaaaaaaaaaa"), row("bbbbbbbbbbb")],
    [],
    {
      failVideo: "aaaaaaaaaaa",
    },
  );
  await assert.rejects(manager.synchronize(), /1.*video|incomplete/i);
  assert.ok(records.has("bbbbbbbbbbb"));
});

test("invalid timestamps are rejected before calling the history API", async (t) => {
  const { manager, searches } = setup(t, []);
  for (const value of [NaN, Infinity, -1, "0"]) {
    await assert.rejects(manager.synchronize(value), /startTime/);
  }
  assert.equal(searches.length, 0);
});

test("skipExisting still imports missing older videos while preserving known records", async (t) => {
  const known = {
    strIdent: "aaaaaaaaaaa",
    strTitle: "Known title",
    intTimestamp: 9000,
    intCount: 5,
  };
  const { manager, records } = setup(
    t,
    [
      row("aaaaaaaaaaa"),
      row("bbbbbbbbbbb", {
        lastVisitTime: 1000,
      }),
    ],
    [known],
  );
  const result = await manager.synchronize(0, true);
  assert.equal(result.newCount, 1);
  assert.equal(result.updatedCount, 0);
  assert.deepEqual(records.get("aaaaaaaaaaa"), known);
  assert.ok(records.has("bbbbbbbbbbb"));
  assert.equal((await manager.synchronize(0, true)).newCount, 0);
});

test("manual import repairs placeholder titles without reducing timestamps or counts", async (t) => {
  const { manager, records, writes } = setup(
    t,
    [row("aaaaaaaaaaa")],
    [
      {
        strIdent: "aaaaaaaaaaa",
        strTitle: "YouTube",
        intTimestamp: 9000,
        intCount: 8,
      },
    ],
  );
  assert.equal((await manager.synchronize()).updatedCount, 1);
  assert.partialDeepStrictEqual(records.get("aaaaaaaaaaa"), {
    strIdent: "aaaaaaaaaaa",
    strTitle: "A history video",
    intTimestamp: 9000,
    intCount: 8,
  });
  assert.equal((await manager.synchronize()).updatedCount, 0);
  assert.equal(writes.length, 1);
});

test("search errors fail the import and a later retry is allowed", async (t) => {
  const { manager, records } = setup(t, [], [], { failSearch: true });
  await assert.rejects(manager.synchronize(), /permission denied/);
  assert.equal(records.size, 0);
  chrome.history.search = async () => [];
  assert.equal((await manager.synchronize()).newCount, 0);
});

test("unknown source dates are counted instead of inventing watch timestamps", async (t) => {
  const { manager, records } = setup(t, [
    row("aaaaaaaaaaa", { lastVisitTime: undefined }),
  ]);
  const result = await manager.synchronize();
  assert.equal(result.unknownTimestampCount, 1);
  assert.equal(result.newCount, 0);
  assert.equal(records.size, 0);
});

test("concurrent requests share matching imports and preserve differing skipExisting options", async (t) => {
  const { manager, records, writes } = setup(
    t,
    [row("aaaaaaaaaaa")],
    [
      {
        strIdent: "aaaaaaaaaaa",
        strTitle: "Known title",
        intTimestamp: 1000,
        intCount: 1,
      },
    ],
  );
  const automatic = manager.synchronize(0, true);
  assert.equal(automatic, manager.synchronize(0, true));
  const manual = manager.synchronize(0, false);
  assert.notEqual(automatic, manual);
  const [autoResult, manualResult] = await Promise.all([automatic, manual]);
  assert.equal(autoResult.updatedCount, 0);
  assert.equal(manualResult.updatedCount, 1);
  assert.equal(records.get("aaaaaaaaaaa").intTimestamp, 2000);
  assert.equal(writes.length, 1);
});

test("incremental import respects startTime and excludes unrelated pages", async (t) => {
  const { manager, records } = setup(t, [
    row("aaaaaaaaaaa", { lastVisitTime: 1000 }),
    row("bbbbbbbbbbb", { lastVisitTime: 3000 }),
    row("ccccccccccc", {
      url: "https://www.youtube.com/playlist?list=ccccccccccc",
      lastVisitTime: 4000,
    }),
  ]);
  assert.equal((await manager.synchronize(2000)).newCount, 1);
  assert.deepEqual([...records.keys()], ["bbbbbbbbbbb"]);
});

test("more than one page of videos at the same timestamp is fully imported", async (t) => {
  const rows = Array.from({ length: 2000 }, (_, i) =>
    row(String(i).padStart(11, "0")),
  );
  const { manager, records } = setup(t, rows);
  assert.equal((await manager.synchronize()).newCount, rows.length);
  assert.equal(records.size, rows.length);
});

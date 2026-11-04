import assert from "node:assert/strict";
import test from "node:test";
import { HistoryManager } from "../extension/sources/bg-history.js";
import { YoutubeManager } from "../extension/sources/bg-youtube.js";
import { VideoTracker } from "../extension/background/video-tracker.js";
import { historyEntries } from "../extension/history/history-events.js";
import { memoryHistory } from "./support/memory-history.js";

const cutoff = new Date(2026, 10, 2).getTime();
const opened = cutoff + 17 * 3_600_000 + 55 * 60_000;
const id = "aaaaaaaaaaa";
const title = "Picard's Final Journey with Q | Honouring Patrick Stewart";
const url = `https://www.youtube.com/watch?v=${id}`;

function setup(t) {
  t.mock.method(Date, "now", () => opened + 120_000);
  const previous = globalThis.chrome;
  const local = { measuredHistoryStart: cutoff };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...local }),
        set: async (values) => Object.assign(local, values),
      },
      sync: { get: async () => ({ idCondition_Youprog: true }) },
    },
    history: {
      search: async ({ startTime, endTime }) =>
        [
          { url, title, lastVisitTime: opened, visitCount: 2 },
          {
            url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
            title: "Older video",
            lastVisitTime: cutoff - 3_600_000,
            visitCount: 1,
          },
        ].filter(
          (item) =>
            item.lastVisitTime >= startTime && item.lastVisitTime < endTime,
        ),
    },
    runtime: { getPlatformInfo: async () => ({}) },
    tabs: { query: async () => [] },
  };
  t.after(() => {
    globalThis.chrome = previous;
  });
  const { provider, records } = memoryHistory();
  const factory = { getCurrentProvider: () => provider };
  const history = new HistoryManager();
  history.setProviderFactory(factory);
  const youtube = new YoutubeManager();
  youtube.setProviderFactory(factory);
  const tracker = new VideoTracker();
  const report = (sessionId, watchedMilliseconds) =>
    tracker.recordWatch(
      {
        videoId: id,
        title,
        sessionId,
        watchedMilliseconds,
        reason: "progress",
      },
      { tab: { id: 1, url }, frameId: 0, documentId: "doc" },
    );
  return { history, youtube, tracker, records, report };
}

test("brief visit, history sync, then qualified replay produce exactly one stored watch", async (t) => {
  const { history, youtube, tracker, records, report } = setup(t);
  await tracker.initialize(youtube);
  await report("00000000-0000-4000-8000-000000000001", 2000);
  assert.equal(records.has(id), false);
  assert.equal((await history.preview()).totalCount, 1);
  await history.synchronize(0, true);
  assert.equal(records.has(id), false, "a visit is not a qualified watch");
  assert.ok(records.has("bbbbbbbbbbb"), "older history remains importable");
  await report("00000000-0000-4000-8000-000000000002", 60_000);
  // A later manual import must not add the navigation timestamp or visit count.
  await history.synchronize(0, false);
  const video = records.get(id);
  assert.equal(video.intCount, 1);
  assert.equal(historyEntries([video]).length, 1);
  assert.equal(video.watchEvents[0].source, "playback");
  // A new manager represents a later worker run; the stored boundary must hold.
  const restarted = new HistoryManager();
  restarted.setProviderFactory({
    getCurrentProvider: () => history.getProvider(),
  });
  await restarted.synchronize(0, false);
  assert.equal(records.get(id).intCount, 1);
  await report("00000000-0000-4000-8000-000000000003", 60_000);
  assert.equal(
    records.get(id).intCount,
    2,
    "two qualified plays still count twice",
  );
});

function historyPage() {
  const section = (date, videoId) => ({
    itemSectionRenderer: {
      header: { itemSectionHeaderRenderer: { title: { simpleText: date } } },
      contents: [{ videoRenderer: { videoId, title: { simpleText: title } } }],
    },
  });
  return `<script>var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [
                    section("November 2, 2026", id),
                    section("November 1, 2026", "bbbbbbbbbbb"),
                    { videoRenderer: { videoId: "ccccccccccc" } },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  })};</script>`;
}

test("browser results cannot bypass the boundary with a newer lastVisitTime", async (t) => {
  const { history, records } = setup(t);
  chrome.history.search = async () => [
    { url, title, lastVisitTime: opened, visitCount: 2 },
    {
      url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
      title: "At the boundary",
      lastVisitTime: cutoff,
      visitCount: 1,
    },
  ];
  assert.equal((await history.preview()).totalCount, 0);
  await history.synchronize();
  assert.equal(records.size, 0);
});

test("YouTube history cannot import current, later, or undated unmeasured watches", async (t) => {
  const { youtube, records } = setup(t);
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    text: async () => historyPage(),
  }));
  assert.equal((await youtube.previewHistory()).totalCount, 1);
  await youtube.synchronize();
  assert.deepEqual([...records.keys()], ["bbbbbbbbbbb"]);
  // Yesterday's brief visit remains excluded after midnight, not just today.
  t.mock.method(Date, "now", () => opened + 86_400_000);
  await youtube.synchronize();
  assert.deepEqual([...records.keys()], ["bbbbbbbbbbb"]);
});

function resumePage(cards) {
  const card = ([videoId, length, percent]) => ({
    lockupViewModel: {
      contentId: videoId,
      contentImage: {
        thumbnailViewModel: {
          overlays: [
            {
              thumbnailBottomOverlayViewModel: {
                progressBar: {
                  thumbnailOverlayProgressBarViewModel: {
                    startPercent: percent,
                  },
                },
                badges: [{ thumbnailBadgeViewModel: { text: length } }],
              },
            },
          ],
        },
      },
    },
  });
  return `<script>var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        header: {
                          itemSectionHeaderRenderer: {
                            title: { simpleText: "Today" },
                          },
                        },
                        contents: cards.map(card),
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  })};</script>`;
}

test("YouTube's resume position adds missing videos, never brief views or known ones", async (t) => {
  const { youtube, records } = setup(t);
  const provider = youtube.getProvider();
  await provider.putVideo({
    strIdent: "kkkkkkkkkkk",
    strTitle: "Known",
    intTimestamp: cutoff - 86_400_000,
    intCount: 1,
  });
  await provider.putVideo({
    strIdent: "ddddddddddd",
    strTitle: "Deleted",
    intTimestamp: cutoff - 86_400_000,
    intDeletedAt: cutoff - 3_600_000,
    intCount: 1,
  });
  const known = structuredClone(records.get("kkkkkkkkkkk"));
  const deleted = structuredClone(records.get("ddddddddddd"));
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true,
    text: async () =>
      resumePage([
        ["mmmmmmmmmmm", "8:58", 59],
        ["fffffffffff", "1:22", 100],
        ["sssssssssss", "0:38", 100],
        ["lllllllllll", "27:28", 3],
        ["ppppppppppp", "18:57", 10],
        ["kkkkkkkkkkk", "10:00", 100],
        ["ddddddddddd", "10:00", 100],
      ]),
  }));
  assert.equal((await youtube.previewHistory()).newCount, 2);
  await youtube.synchronize();
  await youtube.synchronize();
  assert.deepEqual(
    [...records.keys()].sort(),
    ["ddddddddddd", "fffffffffff", "kkkkkkkkkkk", "mmmmmmmmmmm"],
    "a short video, a brief view and YouTube's 10% floor prove no minute",
  );
  assert.equal(records.get("mmmmmmmmmmm").intCount, 1);
  assert.equal(records.get("mmmmmmmmmmm").watchEvents[0].precision, "day");
  assert.deepEqual(records.get("kkkkkkkkkkk"), known);
  assert.deepEqual(records.get("ddddddddddd"), deleted);
});

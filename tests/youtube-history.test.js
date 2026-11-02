import assert from "node:assert/strict";
import test from "node:test";
import { YoutubeManager } from "../extension/sources/bg-youtube.js";
import {
  parseHistoryPage,
  extractHistoryContinuationToken,
  parseHistoryContinuationResponse,
} from "../extension/sources/youtube-parser.js";

const video = (id, title = "History video") => ({
  videoRenderer: { videoId: id, title: { simpleText: title } },
});
const continuation = (token) => ({
  continuationItemRenderer: {
    continuationEndpoint: { continuationCommand: { token } },
  },
});
function page(items, tabIndex = 0) {
  const tabs = Array.from({ length: tabIndex }, () => ({ tabRenderer: {} }));
  tabs.push({
    tabRenderer: {
      selected: true,
      content: {
        sectionListRenderer: { contents: [section(items)] },
      },
    },
  });
  return `<script>ytcfg.set(${JSON.stringify({
    INNERTUBE_API_KEY: "test-key",
    INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "1" } },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    SESSION_INDEX: "2",
  })});var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: { tabs },
    },
  })};</script>`;
}
const section = (items) => ({
  itemSectionRenderer: {
    header: { itemSectionHeaderRenderer: { title: { simpleText: "Today" } } },
    contents: items,
  },
});
const response = (items) => ({
  onResponseReceivedActions: [
    {
      appendContinuationItemsAction: { continuationItems: [section(items)] },
    },
  ],
});

test("history reads the selected tab and nested continuation", () => {
  const html = page([section([video("aaaaaaaaaaa"), continuation("next")])], 1);
  assert.equal(parseHistoryPage(html).length, 1);
  assert.equal(extractHistoryContinuationToken(html), "next");
});

test("continuations include direct videos and nested Shorts shelves", () => {
  const parsed = parseHistoryContinuationResponse(
    response([
      video("aaaaaaaaaaa"),
      section([
        {
          reelShelfRenderer: {
            items: [
              {
                shortsLockupViewModel: {
                  onTap: {
                    innertubeCommand: {
                      reelWatchEndpoint: { videoId: "bbbbbbbbbbb" },
                    },
                  },
                  overlayMetadata: { primaryText: { content: "Short title" } },
                },
              },
            ],
          },
        },
        continuation("next"),
      ]),
    ]),
  );
  assert.deepEqual(
    parsed.videos.map((v) => v.strIdent),
    ["aaaaaaaaaaa", "bbbbbbbbbbb"],
  );
  assert.equal(parsed.nextToken, "next");
});

function setup(t, initial, continuations, existing = []) {
  const records = new Map(existing.map((v) => [v.strIdent, v]));
  const requested = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    if (!options?.body) return { ok: true, text: async () => initial };
    const token = JSON.parse(options.body).continuation;
    requested.push({ token, headers: options.headers });
    const result = continuations[token];
    return result?.ok === false
      ? result
      : { ok: true, json: async () => result };
  });
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ measuredHistoryStart: Date.now() + 86_400_000 }),
      },
    },
    runtime: { id: "fixture-extension", getPlatformInfo: async () => ({}) },
    declarativeNetRequest: { updateSessionRules: async () => {} },
    cookies: {
      get: (_details, cb) => {
        const cookie = { value: "test-cookie" };
        cb?.(cookie);
        return Promise.resolve(cookie);
      },
    },
  };
  t.after(() => {
    globalThis.chrome = previousChrome;
  });
  const manager = new YoutubeManager();
  manager.setProviderFactory({
    getCurrentProvider: () => ({
      getVideo: async (id) => records.get(id),
      putVideo: async (v) => {
        records.set(v.strIdent, v);
      },
    }),
  });
  return { manager, records, requested };
}

test("history preview scans all pages, deduplicates repeat watches and leaves records untouched", async (t) => {
  const known = {
    strIdent: "aaaaaaaaaaa",
    strTitle: "Saved",
    intTimestamp: 1000,
  };
  const { manager, records, requested } = setup(
    t,
    page([section([video(known.strIdent)]), continuation("older")]),
    { older: response([video(known.strIdent), video("bbbbbbbbbbb")]) },
    [known],
  );
  assert.partialDeepStrictEqual(await manager.previewHistory(), {
    totalCount: 2,
    existingCount: 1,
    newCount: 1,
  });
  assert.equal(requested.length, 1);
  assert.deepEqual([...records.values()], [known]);
});

test("sync walks through known videos to insert missing older videos, idempotently", async (t) => {
  const known = {
    strIdent: "aaaaaaaaaaa",
    strTitle: "History video",
    intTimestamp: Date.now(),
    intCount: 4,
  };
  const { manager, records, requested } = setup(
    t,
    page([section([video(known.strIdent)]), continuation("page-2")]),
    {
      "page-2": response([video(known.strIdent), continuation("page-3")]),
      "page-3": response([section([video("bbbbbbbbbbb")])]),
    },
    [known],
  );
  const result = await manager.synchronize();
  assert.equal(result.newCount, 1);
  assert.equal(records.size, 2);
  assert.deepEqual(records.get(known.strIdent), known);
  assert.equal(
    result.updatedCount,
    0,
    "same-day source record must not be reimported",
  );
  assert.deepEqual(
    requested.map((r) => r.token),
    ["page-2", "page-3"],
  );
  assert.equal(requested[0].headers["X-Goog-AuthUser"], "2");
  assert.equal((await manager.synchronize()).newCount, 0);
});

test("failed pagination is reported as failure while imported records are retained", async (t) => {
  const { manager, records } = setup(
    t,
    page([section([video("aaaaaaaaaaa")]), continuation("page-2")]),
    { "page-2": { ok: false, status: 503 } },
  );
  await assert.rejects(manager.synchronize(), /503/);
  assert.equal(records.size, 1);
});

test("unrecognized or signed-out pages must not report a successful empty sync", async (t) => {
  const { manager } = setup(t, "<html>Please sign in</html>", {});
  await assert.rejects(manager.synchronize(), /history|sign.in/i);
});

test("history scan continues beyond the former 500-page limit", async (t) => {
  const pages = {};
  for (let i = 1; i <= 501; i++) {
    pages[`page-${i}`] = response(
      i === 501 ? [video("bbbbbbbbbbb")] : [continuation(`page-${i + 1}`)],
    );
  }
  const { manager, records, requested } = setup(
    t,
    page([continuation("page-1")]),
    pages,
  );
  const result = await manager.synchronize();
  assert.equal(result.newCount, 1);
  assert.equal(result.pagesFetched, 501);
  assert.equal(requested.length, 501);
  assert.ok(records.has("bbbbbbbbbbb"));
});

test("simultaneous startup and manual sync share the same import", async (t) => {
  const { manager, records } = setup(t, page([video("aaaaaaaaaaa")]), {});
  const first = manager.synchronize();
  const second = manager.synchronize();
  assert.equal(first, second);
  await first;
  assert.equal(records.size, 1);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test("repeated continuation tokens fail instead of looping or claiming completion", async (t) => {
  const { manager, requested } = setup(t, page([continuation("loop")]), {
    loop: response([video("aaaaaaaaaaa"), continuation("loop")]),
  });
  await assert.rejects(manager.synchronize(), /repeated.*token/);
  assert.equal(requested.length, 1);
});

test("missing sign-in cookies fail explicitly after preserving first-page imports", async (t) => {
  const { manager, records } = setup(
    t,
    page([video("aaaaaaaaaaa"), continuation("next")]),
    {},
  );
  chrome.cookies.get = (_details, cb) => cb(null);
  await assert.rejects(manager.synchronize(), /sign-in cookie/);
  assert.equal(records.size, 1);
});

test("database write failures are reported after trying the remaining videos", async (t) => {
  const { manager, records } = setup(
    t,
    page([video("aaaaaaaaaaa"), video("bbbbbbbbbbb")]),
    {},
  );
  const provider = manager.getProvider();
  manager.setProviderFactory({
    getCurrentProvider: () => ({
      ...provider,
      putVideo: async (v) => {
        if (v.strIdent === "aaaaaaaaaaa") throw new Error("Write failed");
        return provider.putVideo(v);
      },
    }),
  });
  await assert.rejects(manager.synchronize(), /Could not store 1/);
  assert.ok(records.has("bbbbbbbbbbb"));
});

test("empty history succeeds and malformed continuation responses fail", async (t) => {
  const { manager } = setup(t, page([]), {});
  assert.equal((await manager.synchronize()).newCount, 0);
  assert.throws(() => parseHistoryContinuationResponse({}), /incomplete/);
  assert.throws(
    () => parseHistoryContinuationResponse({ error: { code: 401 } }),
    /error/,
  );
});

test("lockup videos retain source dates, missing titles do not drop videos, playlists are excluded", () => {
  const videos = parseHistoryPage(
    page([
      {
        itemSectionRenderer: {
          header: {
            itemSectionHeaderRenderer: {
              title: { simpleText: "October 25, 2026" },
            },
          },
          contents: [
            {
              lockupViewModel: {
                contentId: "aaaaaaaaaaa",
                contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                metadata: {
                  lockupMetadataViewModel: { title: { content: "A &amp; B" } },
                },
              },
            },
            { videoRenderer: { videoId: "bbbbbbbbbbb" } },
            {
              lockupViewModel: {
                contentId: "ccccccccccc",
                contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST",
              },
            },
          ],
        },
      },
    ]),
  );
  assert.deepEqual(
    videos.map((v) => [v.strIdent, v.strTitle]),
    [
      ["aaaaaaaaaaa", "A & B"],
      ["bbbbbbbbbbb", ""],
    ],
  );
  assert.equal(videos[0].intTimestamp, new Date(2026, 9, 25).getTime());
  assert.equal(videos[0].watchEvents[0].precision, "day");
});

test("history parser never imports cards from sidebar recommendations", () => {
  const data = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [video("aaaaaaaaaaa")],
                },
              },
            },
          },
        ],
        secondaryContents: {
          sectionListRenderer: { contents: [video("bbbbbbbbbbb")] },
        },
      },
    },
  };
  assert.deepEqual(
    parseHistoryPage(`var ytInitialData = ${JSON.stringify(data)};`).map(
      (v) => v.strIdent,
    ),
    ["aaaaaaaaaaa"],
  );
});

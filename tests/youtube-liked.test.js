import assert from "node:assert/strict";
import test from "node:test";
import { parseLikedVideosPage } from "../extension/sources/youtube-liked-parser.js";
import {
  likedVideo,
  continuation,
  playlistResponse,
  likedPage,
  setupLikedSync,
} from "./support/youtube-liked.js";

test("liked import continues past known pages, adds older gaps, and is idempotent", async (t) => {
  const known = {
    strIdent: "aaaaaaaaaaa",
    strTitle: "Liked video",
    intTimestamp: 1234,
    intCount: 5,
  };
  const { manager, records, requests } = setupLikedSync(
    t,
    likedPage([likedVideo(known.strIdent), continuation("next")]),
    {
      next: playlistResponse([
        likedVideo(known.strIdent),
        continuation("last"),
      ]),
      last: playlistResponse([likedVideo("bbbbbbbbbbb")]),
    },
    [known],
  );
  const result = await manager.synchronizeLikedVideos();
  assert.equal(result.newCount, 1);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.pagesFetched, 2);
  assert.equal(records.size, 2);
  assert.deepEqual(records.get(known.strIdent), known);
  assert.equal(requests[0].credentials, "include");
  assert.equal(requests[1].headers["X-Goog-AuthUser"], "2");
  assert.equal(requests[1].headers["X-Goog-PageId"], "test-channel");
  assert.equal((await manager.synchronizeLikedVideos()).newCount, 0);
});

test("liked parser handles escaped, split and missing titles without using upload dates", () => {
  const items = [
    likedVideo("aaaaaaaaaaa", 'A "quoted" \\ title &amp; more'),
    {
      playlistVideoRenderer: {
        videoId: "bbbbbbbbbbb",
        title: { runs: [{ text: "Part " }, { text: "two" }] },
        publishedTimeText: { simpleText: "Yesterday" },
      },
    },
    { playlistVideoRenderer: { videoId: "ccccccccccc" } },
  ];
  const videos = parseLikedVideosPage(likedPage(items));
  assert.deepEqual(
    videos.map((v) => v.strTitle),
    ['A "quoted" \\ title & more', "Part two", ""],
  );
  assert.ok(videos.every((v) => v.intTimestamp === null));
});

test("liked import reports HTTP failure and retains first-page writes", async (t) => {
  const { manager, records } = setupLikedSync(
    t,
    likedPage([likedVideo("aaaaaaaaaaa"), continuation("next")]),
    {
      next: { ok: false, status: 503 },
    },
  );
  await assert.rejects(manager.synchronizeLikedVideos(), /503/);
  assert.equal(records.size, 1);
});

test("liked import rejects signed-out and unrecognized pages", async (t) => {
  const { manager } = setupLikedSync(t, "<html>Sign in</html>");
  await assert.rejects(manager.synchronizeLikedVideos(), /liked|sign.in/i);
  assert.throws(
    () =>
      parseLikedVideosPage(
        likedPage([], {
          responseContext: { mainAppWebResponseContext: { loggedOut: true } },
        }),
      ),
    /sign.in/i,
  );
});

test("concurrent liked imports share one scan", async (t) => {
  const { manager, writes, requests } = setupLikedSync(
    t,
    likedPage([likedVideo("aaaaaaaaaaa")]),
  );
  const first = manager.synchronizeLikedVideos();
  const second = manager.synchronizeLikedVideos();
  assert.equal(first, second);
  await first;
  assert.equal(writes.length, 1);
  assert.equal(requests.length, 1);
});

test("empty liked playlists succeed without sign-in cookies", async (t) => {
  const { manager, requests } = setupLikedSync(t, likedPage([]));
  chrome.cookies.get = () =>
    assert.fail("single-page imports do not need cookie lookup");
  const result = await manager.synchronizeLikedVideos();
  assert.equal(result.totalSeen, 0);
  assert.equal(result.newCount, 0);
  assert.equal(requests.length, 1);
});

test("liked pagination processes endpoint and reload batches to the last page", async (t) => {
  const { manager, records } = setupLikedSync(
    t,
    likedPage([continuation("next")]),
    {
      next: {
        onResponseReceivedEndpoints: [
          {
            reloadContinuationItemsCommand: {
              continuationItems: [
                likedVideo("aaaaaaaaaaa"),
                continuation("last"),
              ],
            },
          },
        ],
      },
      last: playlistResponse([likedVideo("bbbbbbbbbbb")]),
    },
  );
  const result = await manager.synchronizeLikedVideos();
  assert.equal(result.newCount, 2);
  assert.equal(result.objVideos.length, 2);
  assert.equal(records.size, 2);
});

test("liked preview counts all pages without importing or updating videos", async (t) => {
  const known = {
    strIdent: "aaaaaaaaaaa",
    strTitle: "Saved",
    intTimestamp: 1000,
  };
  const { manager, records, writes } = setupLikedSync(
    t,
    likedPage([likedVideo(known.strIdent), continuation("older")]),
    {
      older: playlistResponse([
        likedVideo(known.strIdent),
        likedVideo("bbbbbbbbbbb"),
      ]),
    },
    [known],
  );
  assert.partialDeepStrictEqual(await manager.previewLikedVideos(), {
    totalCount: 2,
    existingCount: 1,
    newCount: 1,
  });
  assert.deepEqual(writes, []);
  assert.deepEqual([...records.values()], [known]);
  assert.equal((await manager.synchronizeLikedVideos()).newCount, 1);
  assert.equal((await manager.previewLikedVideos()).newCount, 0);
});

test("failed preview does not present partial counts or import earlier pages", async (t) => {
  const pages = { next: new Error("Offline") };
  const { manager, records } = setupLikedSync(
    t,
    likedPage([likedVideo("aaaaaaaaaaa"), continuation("next")]),
    pages,
  );
  await assert.rejects(manager.previewLikedVideos(), /Offline/);
  assert.equal(records.size, 0);
  pages.next = playlistResponse([]);
  assert.equal((await manager.previewLikedVideos()).newCount, 1);
});

test("liked pagination rejects repeated tokens and can retry after failure", async (t) => {
  const pages = {
    next: playlistResponse([likedVideo("aaaaaaaaaaa"), continuation("next")]),
  };
  const { manager, records } = setupLikedSync(
    t,
    likedPage([continuation("next")]),
    pages,
  );
  await assert.rejects(manager.synchronizeLikedVideos(), /repeated.*token/);
  pages.next = playlistResponse([
    likedVideo("aaaaaaaaaaa"),
    likedVideo("bbbbbbbbbbb"),
  ]);
  assert.equal((await manager.synchronizeLikedVideos()).newCount, 1);
  assert.equal(records.size, 2);
});

test("missing liked sign-in cookies and request configuration fail explicitly", async (t) => {
  const html = likedPage([likedVideo("aaaaaaaaaaa"), continuation("next")]);
  const { manager, records } = setupLikedSync(t, html);
  chrome.cookies.get = (_details, cb) => cb(null);
  await assert.rejects(manager.synchronizeLikedVideos(), /sign-in cookie/);
  assert.equal(records.size, 1);
  const missingConfig = setupLikedSync(
    t,
    html.replace('"INNERTUBE_API_KEY":"test-key",', ""),
  );
  await assert.rejects(
    missingConfig.manager.synchronizeLikedVideos(),
    /request configuration/,
  );
});

test("malformed and signed-out continuation responses fail instead of silently ending", async (t) => {
  const pages = { next: {} };
  const { manager } = setupLikedSync(
    t,
    likedPage([continuation("next")]),
    pages,
  );
  await assert.rejects(manager.synchronizeLikedVideos(), /incomplete/);
  pages.next = { error: { code: 401 } };
  await assert.rejects(manager.synchronizeLikedVideos(), /continuation error/);
  pages.next = {
    ...playlistResponse([]),
    alerts: [{ alertRenderer: { type: "ERROR" } }],
  };
  await assert.rejects(manager.synchronizeLikedVideos(), /continuation error/);
  pages.next = new Error("Network disconnected");
  await assert.rejects(
    manager.synchronizeLikedVideos(),
    /Network disconnected/,
  );
});

test("liked write errors are reported after trying the remaining videos", async (t) => {
  const { manager, provider, records } = setupLikedSync(
    t,
    likedPage([likedVideo("aaaaaaaaaaa"), likedVideo("bbbbbbbbbbb")]),
  );
  const write = provider.putVideo;
  provider.putVideo = async (v) => {
    if (v.strIdent === "aaaaaaaaaaa") throw new Error("Database full");
    return write(v);
  };
  await assert.rejects(manager.synchronizeLikedVideos(), /Could not store 1/);
  assert.ok(records.has("bbbbbbbbbbb"));
});

test("liked parser reads only playlist videos and excludes recommendations and playlists", () => {
  const html = likedPage(
    [
      {
        richItemRenderer: {
          content: {
            lockupViewModel: {
              contentId: "aaaaaaaaaaa",
              contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
              metadata: {
                lockupMetadataViewModel: { title: { content: "A short" } },
              },
            },
          },
        },
      },
      {
        lockupViewModel: {
          contentId: "bbbbbbbbbbb",
          contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST",
        },
      },
      { playlistVideoRenderer: { videoId: "invalid" } },
    ],
    {
      sidebar: {
        playlistVideoRenderer: {
          videoId: "ccccccccccc",
          title: { simpleText: "Recommendation" },
        },
      },
    },
  );
  assert.deepEqual(
    parseLikedVideosPage(html).map((v) => v.strIdent),
    ["aaaaaaaaaaa"],
  );
  assert.throws(
    () =>
      parseLikedVideosPage(
        likedPage([], {
          alerts: [{ alertRenderer: { type: "ERROR" } }],
        }),
      ),
    /incomplete/,
  );
});

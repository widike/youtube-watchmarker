import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLikedVideosResponse,
  parseLikedVideosContinuation,
} from "./youtube-liked-parser.js";
import {
  likedPage,
  likedVideo,
  continuation,
  playlistResponse,
  setupLikedSync,
} from "./test-support/youtube-liked.js";

const lockup = (id, contentType = "LOCKUP_CONTENT_TYPE_VIDEO") => ({
  richItemRenderer: {
    content: {
      lockupViewModel: {
        contentId: id,
        contentType,
        metadata: {
          lockupMetadataViewModel: {
            title: { content: "A liked video &amp; title" },
          },
        },
      },
    },
  },
});
const gridPage = (items, column = "twoColumnBrowseResultsRenderer") =>
  likedPage([], {
    contents: {
      [column]: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                richGridRenderer: {
                  contents: items,
                  header: { playlistVideoRenderer: { videoId: "zzzzzzzzzzz" } },
                },
              },
            },
          },
        ],
      },
    },
    sidebar: { playlistVideoRenderer: { videoId: "xxxxxxxxxxx" } },
  });

test("liked rich grids parse selected feed cards, exclude playlists and ignore recommendations", () => {
  for (const column of [
    "twoColumnBrowseResultsRenderer",
    "singleColumnBrowseResultsRenderer",
  ]) {
    const result = parseLikedVideosResponse(
      gridPage(
        [
          lockup("aaaaaaaaaaa"),
          lockup("bbbbbbbbbbb", "LOCKUP_CONTENT_TYPE_PLAYLIST"),
          { richItemRenderer: { content: likedVideo("ccccccccccc") } },
          continuation("next-grid-page"),
        ],
        column,
      ),
    );
    assert.deepEqual(
      result.videos.map((video) => video.strIdent),
      ["aaaaaaaaaaa", "ccccccccccc"],
    );
    assert.equal(result.videos[0].strTitle, "A liked video & title");
    assert.equal(result.videos[0].intTimestamp, null);
    assert.equal(result.nextToken, "next-grid-page");
  }
});

test("liked grid continuations parse nested feed sections and empty grids finish cleanly", () => {
  const result = parseLikedVideosContinuation(
    playlistResponse([
      {
        richSectionRenderer: {
          content: {
            richShelfRenderer: {
              contents: [lockup("aaaaaaaaaaa"), continuation("older")],
            },
          },
        },
      },
    ]),
  );
  assert.equal(result.videos.length, 1);
  assert.equal(result.nextToken, "older");
  assert.deepEqual(parseLikedVideosResponse(gridPage([])), {
    videos: [],
    nextToken: null,
  });
});

test("liked grid preview and import walk through all pages using the authenticated request flow", async (t) => {
  const { manager, records, writes } = setupLikedSync(
    t,
    gridPage([lockup("aaaaaaaaaaa"), continuation("older")]),
    { older: playlistResponse([lockup("bbbbbbbbbbb")]) },
  );
  assert.partialDeepStrictEqual(await manager.previewLikedVideos(), {
    totalCount: 2,
    existingCount: 0,
    newCount: 2,
  });
  assert.equal(writes.length, 0);
  assert.equal((await manager.synchronizeLikedVideos()).newCount, 2);
  assert.equal(records.size, 2);
});

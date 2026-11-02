import assert from "node:assert/strict";
import test from "node:test";
import { parseLikedVideosResponse } from "../extension/sources/youtube-liked-parser.js";
import {
  likedPage,
  continuation,
  playlistResponse,
  setupLikedSync,
} from "./support/youtube-liked.js";

const card = (id) => ({
  lockupViewModel: {
    contentId: id,
    contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
    metadata: {
      lockupMetadataViewModel: { title: { content: "Liked &amp; saved" } },
    },
  },
});

// Matches the signed-in LL page: sectionList > itemSection > lockupViewModel,
// without an intermediate playlistVideoListRenderer or richGridRenderer.
const sectionPage = (sections) =>
  likedPage([], {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: false,
              content: {
                richGridRenderer: { contents: [card("xxxxxxxxxxx")] },
              },
            },
          },
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: sections,
                  header: card("yyyyyyyyyyy"),
                },
              },
            },
          },
        ],
        secondaryContents: {
          richGridRenderer: { contents: [card("zzzzzzzzzzz")] },
        },
      },
    },
    sidebar: card("wwwwwwwwwww"),
  });

test("liked sections read direct cards across sections and preserve pagination", () => {
  const result = parseLikedVideosResponse(
    sectionPage([
      {
        itemSectionRenderer: {
          contents: [card("aaaaaaaaaaa")],
          header: card("hhhhhhhhhhh"),
        },
      },
      { itemSectionRenderer: { contents: [card("bbbbbbbbbbb")] } },
      continuation("older"),
    ]),
  );
  assert.deepEqual(
    result.videos.map((video) => video.strIdent),
    ["aaaaaaaaaaa", "bbbbbbbbbbb"],
  );
  assert.equal(result.videos[0].strTitle, "Liked & saved");
  assert.ok(result.videos.every((video) => video.intTimestamp === null));
  assert.equal(result.nextToken, "older");
});

test("liked section previews and imports include every paginated video", async (t) => {
  const { manager, records, writes } = setupLikedSync(
    t,
    sectionPage([
      {
        itemSectionRenderer: {
          contents: [card("aaaaaaaaaaa"), continuation("older")],
        },
      },
    ]),
    { older: playlistResponse([card("bbbbbbbbbbb")]) },
  );
  assert.partialDeepStrictEqual(await manager.previewLikedVideos(), {
    totalCount: 2,
    existingCount: 0,
    newCount: 2,
  });
  assert.equal(writes.length, 0);
  assert.equal((await manager.synchronizeLikedVideos()).newCount, 2);
  assert.equal(records.size, 2);
  assert.equal((await manager.previewLikedVideos()).newCount, 0);
});

test("empty selected sections return zero videos and unknown feeds still fail", () => {
  assert.deepEqual(parseLikedVideosResponse(sectionPage([])), {
    videos: [],
    nextToken: null,
  });
  const html = sectionPage([]).replaceAll(
    "sectionListRenderer",
    "unknownFeedRenderer",
  );
  assert.throws(() => parseLikedVideosResponse(html), /sync is incomplete/);
});

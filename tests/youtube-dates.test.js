import assert from "node:assert/strict";
import test from "node:test";
import { parseYouTubeDateText } from "../extension/sources/youtube-dates.js";
import { parseHistoryPage } from "../extension/sources/youtube-parser.js";

const page = (contents) =>
  `<script>var ytInitialData = ${JSON.stringify({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              selected: true,
              content: {
                sectionListRenderer: {
                  contents: [{ itemSectionRenderer: { contents } }],
                },
              },
            },
          },
        ],
      },
    },
  })};</script>`;

test("weekday headers date the past week and never today", () => {
  const wednesday = new Date(2026, 10, 4, 1, 30);
  for (const [label, day] of [
    ["Monday", 2],
    ["Sunday", 1],
    ["Thursday", new Date(2026, 9, 29).getDate()],
    ["Wednesday", new Date(2026, 9, 28).getDate()],
    ["montag", 2],
  ]) {
    const date = new Date(parseYouTubeDateText(label, wednesday));
    assert.equal(date.getDate(), day, label);
    assert.equal(date.getHours(), 0, label);
    assert.ok(date < wednesday, label);
  }
  assert.equal(parseYouTubeDateText("Mondayish", wednesday), null);
});

test("older video cards report YouTube's resume position", () => {
  const [video, floor] = parseHistoryPage(
    page([
      {
        videoRenderer: {
          videoId: "aaaaaaaaaaa",
          lengthText: { simpleText: "1:02:00" },
          thumbnailOverlays: [
            {
              thumbnailOverlayResumePlaybackRenderer: {
                percentDurationWatched: 50,
              },
            },
          ],
        },
      },
      {
        videoRenderer: {
          videoId: "bbbbbbbbbbb",
          lengthText: { simpleText: "1:02:00" },
          thumbnailOverlays: [
            {
              thumbnailOverlayResumePlaybackRenderer: {
                percentDurationWatched: 10,
              },
            },
          ],
        },
      },
    ]),
  );
  assert.equal(video.resumeSeconds, 1860);
  assert.equal(floor.resumeSeconds, 0);
});

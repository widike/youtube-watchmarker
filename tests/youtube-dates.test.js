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

test("German calendar dates and yesterday survive both clock changes", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    assert.equal(
      parseYouTubeDateText("7. Oktober 2026"),
      new Date(2026, 9, 7).getTime(),
    );
    assert.equal(
      parseYouTubeDateText("6. März 2026"),
      new Date(2026, 2, 6).getTime(),
    );
    assert.equal(parseYouTubeDateText("31. Februar 2026"), null);
    assert.equal(
      parseYouTubeDateText("Yesterday", new Date(2026, 2, 30, 0, 30)),
      new Date(2026, 2, 29).getTime(),
    );
    assert.equal(
      parseYouTubeDateText("Gestern", new Date(2026, 9, 25, 23, 30)),
      new Date(2026, 9, 24).getTime(),
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

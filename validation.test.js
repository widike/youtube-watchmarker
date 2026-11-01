import assert from "node:assert/strict";
import test from "node:test";
import { isValidVideoTitle } from "./validation.js";

const unavailableTitles = [
  "- YouTube",
  "  - YouTube  ",
  "YouTube",
  "youtube",
  "Deleted video",
  "[deleted video]",
  "Private video - YouTube",
  "Video unavailable - YouTube",
  "Gelöschtes Video",
  "[Privates Video]",
  "Video nicht verfügbar - YouTube",
];

test("unavailable page titles are not video metadata", () => {
  for (const title of unavailableTitles)
    assert.equal(isValidVideoTitle(title), false, title);
});

test("meaningful titles remain valid, including Unicode and YouTube suffixes", () => {
  for (const title of [
    "猫",
    "[東京]",
    "Grüße 😀",
    "A real video - YouTube",
    "Why was this video deleted?",
  ])
    assert.equal(isValidVideoTitle(title), true, title);
});

import test from "node:test";
import assert from "node:assert/strict";
import { titleWords, commonWords } from "./statistics-words.js";
import { summarizeHistory } from "./history-statistics.js";
import { queryHistory } from "./history-query.js";
import { wordCloud, wordSize } from "./ui/statistics-word-cloud.js";

test("title analysis folds Unicode forms and possessives without stripping accents", () => {
  assert.deepEqual(
    titleWords("ＮＡＳＡ NASA’s NASA's Café Cafe\u0301 Straße STRASSE"),
    ["nasa", "café", "straße", "strasse"],
  );
  assert.deepEqual(titleWords(null), []);
  assert.deepEqual(titleWords(undefined), []);
  assert.deepEqual(titleWords({}), []);
});

test("short technical names survive while URLs, formats, numbers and filler do not", () => {
  assert.deepEqual(
    titleWords(
      "AI VR UI Go C++ C# Node.js 3D after using 4K 1080p 60fps 2026 " +
        "https://example.com/tracking?token=garbage www.example.org/more " +
        "DON’T don't we're let's für die",
    ),
    ["ai", "vr", "ui", "go", "c++", "c#", "node.js", "3d"],
  );
});

test("word segmentation handles scripts without spaces and avoids blind stemming", () => {
  assert.deepEqual(titleWords("学习中文 学习中文"), ["学习", "中文"]);
  assert.deepEqual(titleWords("universe university build building"), [
    "universe",
    "university",
    "build",
  ]);
});

test("regular and irregular inflections collapse across the vocabulary", () => {
  assert.deepEqual(
    titleWords(
      "build built building buildings games game years year children child mice mouse geese goose",
    ),
    ["build", "game", "year", "child", "mouse", "goose"],
  );
  assert.deepEqual(titleWords("universities universe university"), [
    "university",
    "universe",
  ]);
  assert.deepEqual(titleWords("NASA AI VR C++ C# Flutter beardmeatsfood"), [
    "nasa",
    "ai",
    "vr",
    "c++",
    "c#",
    "flutter",
    "beardmeatsfood",
  ]);
});

test("geographic families come from country/demonym data, including multiword names", () => {
  assert.deepEqual(
    titleWords("Russia Russian Russians Ukraine Ukrainian Ukrainians"),
    ["russia", "ukraine"],
  );
  assert.deepEqual(
    titleWords(
      "Germany Germans French France Japan Japanese Brazil Brazilians",
    ),
    ["germany", "france", "japan", "brazil"],
  );
  assert.deepEqual(
    titleWords(
      "New Zealand New Zealanders South Africa South Africans United States Americans",
    ),
    ["new zealand", "south africa", "united states"],
  );
  assert.deepEqual(titleWords("Congo Congolese DR Congo Prussia Russia"), [
    "congo",
    "congolese",
    "dr congo",
    "prussia",
    "russia",
  ]);
});

test("group counts are the union of videos, not summed variant frequencies", () => {
  assert.deepEqual(
    commonWords([
      { strTitle: "Russia Russian Russians" },
      { strTitle: "Russians" },
      { strTitle: "Ukraine Ukrainian Ukrainians" },
      { strTitle: "Ukrainians" },
      { strTitle: "Built buildings" },
      { strTitle: "Building" },
    ]),
    [
      { word: "build", count: 2 },
      { word: "russia", count: 2 },
      { word: "ukraine", count: 2 },
    ],
  );
});

test("grouped word searches use the same families while ordinary searches stay literal", () => {
  const videos = [
    { strIdent: "aaaaaaaaaaa", strTitle: "France and Russia" },
    { strIdent: "bbbbbbbbbbb", strTitle: "French and Russians" },
    { strIdent: "ccccccccccc", strTitle: "Prussia and universities" },
  ];
  for (const query of ["russia", "france"])
    assert.deepEqual(
      queryHistory(videos, { query, wordGroup: query }).map((v) => v.strIdent),
      ["aaaaaaaaaaa", "bbbbbbbbbbb"],
    );
  assert.equal(queryHistory(videos, { query: "france" }).length, 1);
  assert.equal(queryHistory(videos, { query: "univ" }).length, 1);
  assert.equal(
    queryHistory(videos, { query: "universe", wordGroup: "universe" }).length,
    0,
  );
});

test("document frequency keeps separate videos with equal titles, stable ties and a top-40 limit", () => {
  const titles = Array.from({ length: 45 }, (_, i) => `topic${i}`);
  const videos = titles.flatMap((strTitle) => [{ strTitle }, { strTitle }]);
  videos.push({ strTitle: "oneoff" });
  const words = commonWords(videos);
  assert.equal(words.length, 40);
  assert(words.every(({ count }) => count === 2));
  assert(!words.some(({ word }) => word === "oneoff"));
  assert.deepEqual(commonWords(videos.toReversed()), words);
});

test("only different videos with eligible watches contribute to the selected period", () => {
  const now = Date.now();
  const row = (strIdent, strTitle, intTimestamp, extra = {}) => ({
    strIdent,
    strTitle,
    intTimestamp,
    intCount: 50,
    ...extra,
  });
  const stats = summarizeHistory(
    [
      row("aaaaaaaaaaa", "AI AI recent", now),
      row("bbbbbbbbbbb", "AI recent", now),
      row("ccccccccccc", "AI ancient", now - 2 * 86400000),
      row("ddddddddddd", "AI ancient", now - 3 * 86400000),
      row("eeeeeeeeeee", "AI recent", now, { intDeletedAt: now + 1 }),
      row("fffffffffff", "AI recent", now + 1),
    ],
    { period: "day", now },
  );
  assert.deepEqual(stats.words, [
    { word: "ai", count: 2 },
    { word: "recent", count: 2 },
  ]);
});

test("cloud words still find titles after normalization and possessive cleanup", () => {
  const videos = [
    { strIdent: "aaaaaaaaaaa", strTitle: "ＮＡＳＡ’s Café\u0301" },
    { strIdent: "bbbbbbbbbbb", strTitle: "NASA's Café\u0301" },
  ];
  for (const { word } of commonWords(videos))
    assert.equal(queryHistory(videos, { query: word }).length, 2, word);
});

test("font sizing does not exaggerate near ties and keeps a readable floor", () => {
  assert(wordSize(99, 100) / wordSize(100, 100) > 0.99);
  assert.equal(wordSize(1, 10000), 0.875);
  assert.equal(wordSize(4, 4), wordSize(100, 100));
  assert.equal(wordSize(25, 100) * 2, wordSize(100, 100));
});

test("cloud markup exposes accessible counts and escapes title text", () => {
  const html = wordCloud({ words: [{ word: '<img src="x">', count: 2 }] });
  assert(!html.includes("<img"));
  assert(html.includes("&lt;img"));
  assert(html.includes("2 different videos. Search full library."));
  assert(html.includes('role="list"'));
  assert(!/NaN|Infinity|undefined/.test(wordCloud({ words: [] })));
});

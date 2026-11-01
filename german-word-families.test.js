import test from "node:test";
import assert from "node:assert/strict";
import countries from "world-countries";
import { titleWords, commonWords } from "./statistics-words.js";
import { queryHistory } from "./history-query.js";
import { searchText } from "./shared/search-text.js";

test("German noun inflections and umlaut plurals share readable lemmas", () => {
  assert.deepEqual(
    titleWords(
      "Kind Kinder Kindern Buch Bücher Büchern Haus Häuser Häusern Maus Mäuse",
    ),
    ["kind", "buch", "haus", "maus"],
  );
  assert.deepEqual(titleWords("Jahr Jahre Jahren Straße Straßen"), [
    "jahr",
    "straße",
  ]);
});

test("German regular and irregular verbs normalize using the lookup dictionary", () => {
  assert.deepEqual(titleWords("Er ging und ist gegangen, sie läuft und lief"), [
    "gehen",
    "laufen",
  ]);
  assert.deepEqual(titleWords("Wir bauen, bauten und haben gebaut"), ["bauen"]);
  assert.deepEqual(
    titleWords("Die Kinder lesen Bücher und spielen in den Häusern"),
    ["kind", "lesen", "buch", "spielen", "haus"],
  );
});

test("German adjective inflections preserve umlauts and base forms", () => {
  assert.deepEqual(titleWords("schöne schön schönsten schöner schönes"), [
    "schön",
  ]);
  assert.deepEqual(titleWords("Diese besseren und besten Dinge sind gut"), [
    "gut",
    "ding",
  ]);
});

test("language detection distinguishes shared English/German verb spellings", () => {
  assert(
    titleWords("The singer sang and sings a song about playing games").includes(
      "sing",
    ),
  );
  const german = titleWords(
    "Der Sänger sang und singt mit den Kindern schöne Lieder",
  );
  assert(german.includes("singen"));
  assert(!german.includes("sing"));
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

test("German geographic names, adjectives and gender/plural variants share country families", () => {
  assert.deepEqual(
    titleWords(
      "Russland russisch russische russischen Russe Russen Russin Russinnen",
    ),
    ["russia"],
  );
  assert.deepEqual(
    titleWords(
      "Ukraine ukrainisch ukrainischen Ukrainer Ukrainern Ukrainerin Ukrainerinnen",
    ),
    ["ukraine"],
  );
  assert.deepEqual(
    titleWords(
      "Frankreich französisch französischen Franzose Franzosen Französin Französinnen",
    ),
    ["france"],
  );
  assert.deepEqual(
    titleWords("Deutschland deutsch deutsche Deutschen Deutscher Deutsche"),
    ["germany"],
  );
});

test("all German country names in the country dataset normalize across languages", () => {
  let count = 0;
  for (const { name, translations } of countries) {
    if (!translations?.deu?.common) continue;
    assert.deepEqual(
      titleWords(translations.deu.common),
      [searchText(name.common)],
      translations.deu.common,
    );
    count++;
  }
  assert(count >= 240);
});

test("mixed German/English geographic counts are distinct-video unions and search matches all forms", () => {
  const videos = [
    { strIdent: "aaaaaaaaaaa", strTitle: "Russland Russian Russen Russinnen" },
    { strIdent: "bbbbbbbbbbb", strTitle: "Russen und russische Nachrichten" },
    { strIdent: "ccccccccccc", strTitle: "Russian news" },
    { strIdent: "ddddddddddd", strTitle: "Ukraine ukrainisch Ukrainerinnen" },
  ];
  assert.equal(
    commonWords(videos).find(({ word }) => word === "russia").count,
    3,
  );
  assert.equal(
    queryHistory(videos, { query: "russia", wordGroup: "russia" }).length,
    3,
  );
  assert.equal(queryHistory(videos, { query: "russinnen" }).length, 1);
  assert.equal(
    queryHistory(videos, { query: "ukraine", wordGroup: "ukraine" }).length,
    1,
  );
});

test("German lemma searches find inflected titles after grouping", () => {
  const videos = [
    { strIdent: "aaaaaaaaaaa", strTitle: "Kinder lesen Bücher" },
    { strIdent: "bbbbbbbbbbb", strTitle: "Ein Kind mit einem Buch" },
  ];
  for (const word of ["kind", "buch"])
    assert.equal(
      queryHistory(videos, { query: word, wordGroup: word }).length,
      2,
    );
});

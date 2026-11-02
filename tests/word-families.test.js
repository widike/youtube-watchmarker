import test from "node:test";
import assert from "node:assert/strict";
import countries from "world-countries";
import { searchText } from "../extension/shared/search-text.js";
import { titleWords } from "../extension/statistics/statistics-words.js";

test("every country name in the dataset remains one complete family", () => {
  for (const { name } of countries)
    assert.deepEqual(
      titleWords(name.common),
      [searchText(name.common)],
      name.common,
    );
});

test("unique sovereign-country demonyms merge with their country across the dataset", () => {
  const names = new Map();
  for (const { name, independent, demonyms } of countries) {
    if (!independent) continue;
    for (const demonym of Object.values(demonyms?.eng || {})) {
      const set = names.get(demonym) || new Set();
      set.add(name.common);
      names.set(demonym, set);
    }
  }
  let checked = 0;
  for (const [demonym, matches] of names) {
    if (matches.size !== 1) continue;
    const [name] = matches;
    assert.deepEqual(
      titleWords(`${name} ${demonym}`),
      [searchText(name)],
      demonym,
    );
    checked++;
  }
  assert(checked > 150, "Too few independent demonyms were verified");
});

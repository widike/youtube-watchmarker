import { readFile, writeFile, copyFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { searchText } from "../extension/shared/search-text.js";

const directory = new URL("../data/word-language/", import.meta.url);

export async function bundleGermanLookup() {
  const source = JSON.parse(
    gunzipSync(await readFile(new URL("de-lemma-lookup.json.gz", directory))),
  );
  const lookup = new Map();
  const priorities = new Map();
  // Lowercase dictionary lemmas (e.g. infinitives) take precedence over a
  // capitalized noun collision introduced by case folding, but not over an
  // explicit lowercase inflection in the source table.
  for (const base of Object.values(source)) {
    const word = searchText(base);
    if (base === word) {
      lookup.set(word, word);
      priorities.set(word, 0.5);
    }
  }
  for (const [form, base] of Object.entries(source)) {
    const word = searchText(form);
    const priority = form === word ? 1 : 0;
    if (priority < (priorities.get(word) ?? -1)) continue;
    lookup.set(word, searchText(base));
    priorities.set(word, priority);
  }
  const resolve = (word) => {
    const seen = new Set();
    let base = word;
    while (lookup.has(base) && lookup.get(base) !== base) {
      if (seen.has(base)) return word;
      seen.add(base);
      base = lookup.get(base);
    }
    return base;
  };
  const groups = new Map();
  for (const word of lookup.keys()) {
    const base = resolve(word);
    const forms = groups.get(base) || new Set();
    if (word !== base) forms.add(word);
    groups.set(base, forms);
  }
  const packed = [...groups]
    .sort(([a], [b]) => a.localeCompare(b, "de"))
    .map(([base, forms]) => [base, ...[...forms].sort()].join("\t"))
    .join("\n");
  await writeFile(
    "extension/vendor/german-lemmas.js",
    `// Generated from pinned spaCy German lookup data. See SPACY-LOOKUPS-LICENSE.txt.\nexport default ${JSON.stringify(packed)};\n`,
  );
  await copyFile(
    new URL("SPACY-LOOKUPS-LICENSE.txt", directory),
    "extension/vendor/SPACY-LOOKUPS-LICENSE.txt",
  );
}

export async function germanGeography(countries) {
  const source = JSON.parse(
    await readFile(new URL("german-geography.json", directory), "utf8"),
  );
  const byCode = new Map(
    countries.map(({ cca2 }) => [cca2, { names: [], people: [] }]),
  );
  const byName = new Map();
  const key = (value) => searchText(value).replace(/^the /u, "");
  for (const { cca2, name, translations } of countries)
    for (const value of [name.common, name.official, translations?.deu?.common])
      if (value) byName.set(key(value), cca2);
  const people = (values) =>
    values
      .flatMap((value) => value.split(/[,/]/u))
      .map((value) =>
        searchText(value)
          .trim()
          .replace(/^(?:der|die|das|ein|eine) /u, ""),
      )
      .filter((value) => /\p{L}/u.test(value));
  const adjectiveForms = (value) =>
    ["", "e", "en", "er", "es", "em"].map((suffix) => value + suffix);
  const residentForms = (value) => [
    value,
    ...(value.endsWith("in") ? [value + "nen"] : []),
    ...(value.endsWith("e") || value.endsWith("er") ? [value + "n"] : []),
  ];
  const add = (code, names, adjectives, residents) => {
    const target = byCode.get(code);
    if (!target) return;
    target.names.push(...names);
    target.people.push(
      ...adjectives.flatMap(adjectiveForms),
      ...residents.flatMap(residentForms),
    );
  };
  for (const [code, short, full, adjective, male, female] of source.official)
    add(code, [short, full], people([adjective]), people([male, female]));
  for (const [english, german, residents, adjective] of source.residents)
    add(
      byName.get(key(english)) || byName.get(key(german)),
      [german],
      people([adjective]),
      people([residents]),
    );
  return byCode;
}

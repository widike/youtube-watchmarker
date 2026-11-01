import countries from "../vendor/country-word-families.js";
import { wordLemma, wordLanguage } from "./word-lemmas.js";

const aliases = new Map();
const candidates = new Map();
const longestNames = new Map();
for (const [name, independent, names, demonyms] of countries) {
  for (const [forms, priority] of [
    [names, 2],
    [demonyms, independent ? 1 : 0],
  ]) {
    for (const form of forms) {
      const words = form.split(" ");
      const keys = new Set([
        form,
        ...["en", "de"].map((language) =>
          words.map((word) => wordLemma(word, language)).join(" "),
        ),
      ]);
      for (const key of keys) {
        const matches = candidates.get(key) || new Map();
        matches.set(name, Math.max(priority, matches.get(name) ?? -1));
        candidates.set(key, matches);
      }
    }
  }
}
for (const [form, matches] of candidates) {
  const priority = Math.max(...matches.values());
  const names = [...matches].filter(([, value]) => value === priority);
  // Names outrank demonyms; a sovereign country outranks its dependencies.
  // Equally plausible demonyms remain separate rather than picking arbitrarily.
  if (names.length !== 1) continue;
  aliases.set(form, names[0][0]);
  const parts = form.split(" ");
  longestNames.set(
    parts[0],
    Math.max(parts.length, longestNames.get(parts[0]) || 0),
  );
}
candidates.clear();

/** Normalize inflections and dataset-backed entities, retaining readable labels. */
export function wordFamilies(words) {
  const language = wordLanguage(words);
  const bases = words.map((word) => wordLemma(word, language));
  const result = [];
  for (let index = 0; index < words.length; index++) {
    let family;
    const longest = Math.max(
      longestNames.get(words[index]) || 0,
      longestNames.get(bases[index]) || 0,
    );
    for (let size = Math.min(longest, words.length - index); size > 0; size--) {
      family =
        aliases.get(words.slice(index, index + size).join(" ")) ||
        aliases.get(bases.slice(index, index + size).join(" "));
      if (family) {
        index += size - 1;
        break;
      }
    }
    result.push(family || bases[index]);
  }
  return result;
}

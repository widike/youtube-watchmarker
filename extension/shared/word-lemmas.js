import lemmatize, { englishWords } from "../vendor/lemmatizer.js";
import packedGerman from "../vendor/german-lemmas.js";
import { franc } from "../vendor/language-detector.js";

const german = new Map();
for (const row of packedGerman.split("\n")) {
  const [base, ...forms] = row.split("\t");
  german.set(base, base);
  for (const form of forms) german.set(form, base);
}

const cache = new Map();
export function wordLemma(word, language = "en") {
  if (!/^[\p{L}\p{M}]{3,}$/u.test(word)) return word;
  const key = `${language}:${word}`;
  if (cache.has(key)) return cache.get(key);
  const english = /^[a-z]+$/u.test(word)
    ? lemmatize.adjective(lemmatize.verb(lemmatize.noun(word)))
    : word;
  const knownEnglish = english !== word || Object.hasOwn(englishWords, word);
  const base =
    language === "de"
      ? (german.get(word) ?? english)
      : knownEnglish
        ? english
        : (german.get(word) ?? english);
  if (cache.size >= 10000) cache.clear();
  cache.set(key, base);
  return base;
}

export function wordLanguage(words) {
  return franc(words.join(" "), { only: ["eng", "deu"], minLength: 20 }) ===
    "deu"
    ? "de"
    : "en";
}

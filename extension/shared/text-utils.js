import { HTML_ENTITIES } from "./html-entities.js";

// Windows-1252 differs from Latin-1 in the C1 range. Mojibake often contains
// these punctuation characters, especially in quotes, dashes and emoji.
const C1_CHARACTERS =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const c1Bytes = new Map(
  Array.from(C1_CHARACTERS, (char, index) => [char, index + 0x80]),
);
const byteOf = (char) =>
  c1Bytes.get(char) ?? (char?.codePointAt(0) <= 255 ? char.codePointAt(0) : -1);

/** Repair only valid, local UTF-8 byte sequences; never truncate Unicode. */
export function fixUtf8DoubleEncoding(text) {
  if (typeof text !== "string" || !text) return text;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let result = text;
  for (let pass = 0; pass < 3; pass++) {
    const characters = Array.from(result);
    let repaired = "";
    for (let index = 0; index < characters.length; index++) {
      const lead = byteOf(characters[index]);
      const length =
        lead >= 0xc2 && lead <= 0xdf
          ? 2
          : lead >= 0xe0 && lead <= 0xef
            ? 3
            : lead >= 0xf0 && lead <= 0xf4
              ? 4
              : 0;
      const bytes = characters.slice(index, index + length).map(byteOf);
      if (
        length &&
        bytes.length === length &&
        bytes.slice(1).every((byte) => byte >= 0x80 && byte <= 0xbf)
      ) {
        try {
          repaired += decoder.decode(new Uint8Array(bytes));
          index += length - 1;
          continue;
        } catch {
          // An invalid sequence is ordinary title text; preserve it verbatim.
        }
      }
      repaired += characters[index];
    }
    if (repaired === result) break;
    result = repaired;
  }
  return result;
}

/** DOM strings are already decoded. Do not interpret literal entity text again. */
export function normalizeVideoTitle(text) {
  return typeof text === "string"
    ? fixUtf8DoubleEncoding(text).normalize("NFC").trim()
    : "";
}

/** Decode one layer of encoded source text, including supplementary code points. */
export function decodeHtmlEntitiesAndFixEncoding(text) {
  if (typeof text !== "string" || !text) return text;
  const decoded = text.replace(
    /&(?:#(x[\da-f]+|\d+)|([a-z][\da-z]+));/gi,
    (match, numeric, name) => {
      if (name)
        return Object.hasOwn(HTML_ENTITIES, name) ? HTML_ENTITIES[name] : match;
      let codePoint =
        numeric[0].toLowerCase() === "x"
          ? parseInt(numeric.slice(1), 16)
          : parseInt(numeric, 10);
      if (
        !codePoint ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
      )
        return "\ufffd";
      if (codePoint >= 0x80 && codePoint <= 0x9f)
        return C1_CHARACTERS[codePoint - 0x80];
      return String.fromCodePoint(codePoint);
    },
  );
  return fixUtf8DoubleEncoding(decoded).normalize("NFC");
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  fixUtf8DoubleEncoding,
  decodeHtmlEntitiesAndFixEncoding,
  normalizeVideoTitle,
} from "../extension/shared/text-utils.js";

test("valid Unicode survives encoding repair unchanged", () => {
  for (const title of [
    "Grüße über Öl & Spaß",
    "東京 中文 한국어",
    "العربية עברית",
    "😀 👨‍👩‍👧‍👦 🚀",
    "café – déjà vu © €",
    "é\u0301",
    "𝄞 𐍈",
  ]) {
    assert.equal(fixUtf8DoubleEncoding(title), title);
  }
});

test("repair handles local Latin-1 and Windows-1252 mojibake beside intact Unicode", () => {
  assert.equal(
    fixUtf8DoubleEncoding("GrÃ¼ße — 東京 😀 cafÃ©"),
    "Grüße — 東京 😀 café",
  );
  assert.equal(
    fixUtf8DoubleEncoding("Itâ€™s â€œfineâ€\u009d â€“ ðŸ˜€"),
    "It’s “fine” – 😀",
  );
  assert.equal(fixUtf8DoubleEncoding("GrÃƒÂ¼ÃƒÅ¸e"), "Grüße");
  assert.equal(
    fixUtf8DoubleEncoding("Ã und â broken — 東京"),
    "Ã und â broken — 東京",
  );
});

test("HTML decoding supports named, decimal and hex supplementary characters", () => {
  assert.equal(
    decodeHtmlEntitiesAndFixEncoding(
      "&Auml;&ouml;&szlig; &#128512; &#x1F680; &NotEqualTilde; &unknown;",
    ),
    "Äöß 😀 🚀 ≂̸ &unknown;",
  );
  assert.equal(
    decodeHtmlEntitiesAndFixEncoding("&#0; &#xD800; &#x110000; &#128;"),
    "� � � €",
  );
  assert.equal(
    decodeHtmlEntitiesAndFixEncoding("&amp;lt;b&amp;gt;"),
    "&lt;b&gt;",
  );
});

test("DOM titles preserve literal entity text and normalize composed characters", () => {
  assert.equal(
    normalizeVideoTitle("  Cafe\u0301 &amp; &#128512;  "),
    "Café &amp; &#128512;",
  );
  assert.equal(normalizeVideoTitle(null), "");
});

test("unknown entity names never resolve object prototype members", () => {
  assert.equal(
    decodeHtmlEntitiesAndFixEncoding("&constructor; &toString;"),
    "&constructor; &toString;",
  );
});

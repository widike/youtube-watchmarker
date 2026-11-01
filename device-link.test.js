import assert from "node:assert/strict";
import test from "node:test";
import {
  PAIRING_DIRECTORY_URL,
  decodeConnection,
  encodeConnection,
  loadConnectionProject,
} from "./device-link.js";

const configuration = {
  projectId: "abcdefghijklmnopqrst",
  publishableKey: "sb_publishable_public",
};
test("connection codes contain six letters grouped in threes and accept either case", () => {
  assert.equal(encodeConnection("KMTPXR"), "KMT-PXR");
  for (const value of ["kmt-pxr", "KMTPXR", " Kmt-Pxr\n"])
    assert.equal(decodeConnection(value), "KMTPXR");
});

test("connection codes reject old payloads, digits and malformed groups", () => {
  for (const code of [
    "https://attacker.example/",
    "watchmarker:1:abcdefghijklmnopqrst:sb_publishable_public:" +
      "a".repeat(64),
    "123-456",
    "KMT-PX1",
    "KM-TPXR",
    "KMT--PXR",
    "KMT PXR",
    "KMT-PXＲ",
    "a".repeat(1001),
    null,
  ])
    assert.throws(() => decodeConnection(code));
});

test("directory discovery sends the code in a POST body without credentials and validates the resolved destination", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ configuration });
  });
  assert.deepEqual(await loadConnectionProject("kmt-pxr"), {
    ...configuration,
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
  });
  assert.equal(calls[0].url, PAIRING_DIRECTORY_URL);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    action: "resolve",
    code: "KMTPXR",
  });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.credentials, "omit");
  for (const payload of [
    {},
    { ...configuration, projectId: "attacker.example" },
    { ...configuration, publishableKey: "sb_secret_private" },
  ]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ configuration: payload }),
    );
    await assert.rejects(
      loadConnectionProject("KMTPXR"),
      /incorrect or expired/,
    );
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { decodeConnection, encodeConnection } from "./device-link.js";

const configuration = {
  projectId: "abcdefghijklmnopqrst",
  publishableKey: "sb_publishable_public",
};
const token = "a".repeat(64);

test("connection code carries public configuration and a temporary invitation, never a session", () => {
  const code = encodeConnection(configuration, token);
  assert.deepEqual(decodeConnection(` ${code}\n`), {
    configuration: {
      ...configuration,
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    },
    token,
  });
});

test("connection codes reject arbitrary hosts, secret keys, ambiguous fields and weak tokens", () => {
  for (const code of [
    "https://attacker.example/",
    "watchmarker:1:attacker.example:sb_publishable_public:" + token,
    "watchmarker:1:abcdefghijklmnopqrst:sb_secret_privileged:" + token,
    encodeConnection(configuration, "123456"),
    encodeConnection(configuration, token) + ":extra",
    "a".repeat(1001),
    null,
  ])
    assert.throws(() => decodeConnection(code));
});

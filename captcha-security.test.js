import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTCHA_ORIGIN,
  CAPTCHA_PAGE_URL,
  isAllowedParent,
  isCaptchaReply,
  validateCaptchaConfiguration,
} from "./verification/protocol.js";
import {
  connectionConfiguration,
  loadCaptchaConfiguration,
} from "./supabase-captcha.js";
import { SupabaseAuthClient } from "./supabase-auth-client.js";

test("only the approved verification page and a public widget key are accepted", () => {
  const valid = { pageUrl: CAPTCHA_PAGE_URL, siteKey: "0x4public-widget-key" };
  assert.deepEqual(validateCaptchaConfiguration(valid), valid);
  for (const pageUrl of [
    "https://attacker.example/",
    "javascript:alert(1)",
    CAPTCHA_PAGE_URL + "?token=secret",
    "http://widike.github.io/youtube-watchmarker/verification/",
  ]) {
    assert.throws(() => validateCaptchaConfiguration({ ...valid, pageUrl }));
  }
  for (const siteKey of [null, {}, "<script>", "", "x".repeat(101)]) {
    assert.throws(() => validateCaptchaConfiguration({ ...valid, siteKey }));
  }
});

test("verification replies require the exact origin, frame, nonce and bounded token", () => {
  const source = {};
  const nonce = "a".repeat(64);
  const valid = {
    source,
    origin: CAPTCHA_ORIGIN,
    data: { type: "watchmarker-captcha-result", nonce, token: "human-proof" },
  };
  assert.equal(isCaptchaReply(valid, { source, nonce }), true);
  for (const change of [
    { origin: "https://widike.github.io.attacker.example" },
    { origin: "null" },
    { source: {} },
    { data: { ...valid.data, nonce: "other-attempt" } },
    { data: { ...valid.data, token: "" } },
    { data: { ...valid.data, token: "a".repeat(2049) } },
    { data: { ...valid.data, type: "other" } },
  ])
    assert.equal(
      isCaptchaReply({ ...valid, ...change }, { source, nonce }),
      false,
    );
});

test("the widget only hands tokens to extension pages and encrypted private IPv4 setup pages", () => {
  for (const origin of [
    "chrome-extension://" + "a".repeat(32),
    "https://192.168.178.80:8443",
    "https://10.1.2.3:4433",
    "https://172.16.2.3:8443",
  ])
    assert.equal(isAllowedParent(origin), true, origin);
  for (const origin of [
    "null",
    "http://192.168.1.1",
    "https://192.168.1.1.attacker.example",
    "https://example.com",
    "https://172.32.1.1",
    "https://192.168.1.1/path",
    "https://192.168.1.1?key=x",
    "https://192.168.1.256",
    "chrome-extension://invalid",
  ])
    assert.equal(isAllowedParent(origin), false, origin);
});

test("widget configuration lookup sends only public configuration to the project's RPC", async (t) => {
  const configuration = await connectionConfiguration({
    configuration: {
      projectId: "abcdefghijklmnopqrst",
      publishableKey: "sb_publishable_test",
    },
  });
  let request;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, ...options };
    return Response.json({
      pageUrl: CAPTCHA_PAGE_URL,
      siteKey: "0x4public-widget-key",
    });
  });
  await loadCaptchaConfiguration(configuration);
  assert.equal(
    request.url,
    "https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/watchmarker_captcha_config",
  );
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.body, "{}");
  await assert.rejects(
    connectionConfiguration({
      configuration: {
        projectId: "attacker.example",
        publishableKey: "sb_publishable_test",
      },
    }),
  );
});

test("missing or oversized verification tokens never trigger signup", async (t) => {
  const client = new SupabaseAuthClient();
  const request = t.mock.method(client, "request", async () => {});
  for (const token of [undefined, null, {}, "", "a".repeat(2049)])
    await assert.rejects(
      client.createDeviceSession({}, token),
      /Verify this device/,
    );
  assert.equal(request.mock.callCount(), 0);
});

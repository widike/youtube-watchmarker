import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  prepareYouTubeRequests,
  requestYouTubeApi,
} from "../extension/sources/youtube-request.js";

function setup(t, install = async () => {}) {
  const previous = globalThis.chrome;
  const rules = [];
  globalThis.chrome = {
    runtime: { id: "fixture-extension" },
    cookies: {
      get: (_details, callback) => callback({ value: "fixture-cookie" }),
    },
    declarativeNetRequest: {
      updateSessionRules: async (options) => {
        rules.push(options);
        await install();
      },
    },
  };
  t.after(() => {
    globalThis.chrome = previous;
  });
  return rules;
}

const config = {
  apiKey: "fixture-key",
  authUser: "2",
  clientName: 1,
  clientVersion: "fixture-version",
  delegatedSessionId: "fixture-channel",
  context: { client: { visitorData: "fixture-visitor" } },
};

test("authenticated requests install matching browser headers before sending a continuation", async (t) => {
  const rules = setup(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(rules.length, 1);
    const rule = rules[0].addRules[0];
    assert.equal(rule.action.type, "modifyHeaders");
    const headers = Object.fromEntries(
      rule.action.requestHeaders.map(({ header, value }) => [header, value]),
    );
    assert.equal(headers.Origin, "https://www.youtube.com");
    assert.equal(headers.Referer, "https://www.youtube.com/");
    assert.equal(options.headers["X-Origin"], headers.Origin);
    const [, token] = options.headers.Authorization.split(" ");
    const [timestamp, signature] = token.split("_");
    assert.equal(
      signature,
      createHash("sha1")
        .update(`${timestamp} fixture-cookie ${headers.Origin}`)
        .digest("hex"),
    );
    assert.deepEqual(rule.condition.initiatorDomains, [chrome.runtime.id]);
    assert.deepEqual(rule.condition.requestMethods, ["post"]);
    const matches = new RegExp(rule.condition.regexFilter);
    assert.ok(matches.test(url));
    assert.ok(
      matches.test("https://www.youtube.com/youtubei/v1/feedback?key=test"),
    );
    for (const other of [
      "https://www.youtube.com/youtubei/v1/browse-elsewhere",
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      "https://evil.test/youtubei/v1/browse",
      "https://www.youtube.com.evil.test/youtubei/v1/browse",
    ])
      assert.equal(matches.test(other), false);
    assert.equal(options.headers["X-Goog-AuthUser"], "2");
    assert.equal(options.headers["X-Goog-PageId"], "fixture-channel");
    assert.equal(options.headers["X-Goog-Visitor-Id"], "fixture-visitor");
    assert.equal(options.credentials, "include");
    assert.deepEqual(JSON.parse(options.body), {
      continuation: "next",
      context: config.context,
    });
    return { ok: true };
  });
  await requestYouTubeApi("browse", config, { continuation: "next" });
  await requestYouTubeApi("browse", config, { continuation: "next" });
  assert.equal(rules.length, 1);
});

test("a failed rule installation prevents an uncorrected request and can retry", async (t) => {
  let unavailable = true;
  setup(t, async () => {
    if (unavailable) throw new Error("No header permission");
  });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true }));
  await assert.rejects(
    requestYouTubeApi("browse", config, {}),
    /No header permission/,
  );
  assert.equal(fetch.mock.callCount(), 0);
  unavailable = false;
  await requestYouTubeApi("browse", config, {});
  assert.equal(fetch.mock.callCount(), 1);
});

test("overlapping scans share header setup and arbitrary API endpoints are rejected", async (t) => {
  const rules = setup(t);
  const first = prepareYouTubeRequests();
  assert.equal(first, prepareYouTubeRequests());
  await first;
  assert.equal(rules.length, 1);
  await assert.rejects(
    requestYouTubeApi("https://evil.test", config, {}),
    /Unsupported/,
  );
});

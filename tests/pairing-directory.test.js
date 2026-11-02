import assert from "node:assert/strict";
import test from "node:test";
import { createDirectoryHandler } from "../supabase/functions/pairing-directory/directory.js";

const configuration = {
  projectId: "a".repeat(20),
  publishableKey: "sb_publishable_test",
};
const now = Date.now();
const registration = {
  issuer: "a".repeat(64),
  expiresAt: new Date(now + 500_000).toISOString(),
};
const proof = "b".repeat(64);
const request = (body) =>
  new Request("https://directory.example/", {
    method: "POST",
    body: JSON.stringify(body),
  });

function setup(responses = [registration, true]) {
  const calls = [];
  const handler = createDirectoryHandler({
    url: "https://central.example",
    serviceKey: "server-only",
    now: () => now,
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      return Response.json(responses.shift());
    },
  });
  return { handler, calls };
}

test("directory verifies the issuing installation without receiving or forwarding a device JWT", async () => {
  const { handler, calls } = setup();
  const result = await handler(
    request({ action: "register", code: "KMTPXR", configuration, proof }),
  );
  assert.deepEqual(await result.json(), { registered: true });
  assert.equal(
    calls[0].url,
    `https://${configuration.projectId}.supabase.co/rest/v1/rpc/watchmarker_link_registration`,
  );
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers.apikey, configuration.publishableKey);
  assert.equal(calls[0].redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].body), {
    p_token: "KMTPXR",
    p_proof: proof,
  });
  assert.equal(calls[1].headers.Authorization, "Bearer server-only");
  assert.equal(JSON.parse(calls[1].body).p_project, configuration.projectId);
  assert.equal(calls[1].body.includes(proof), false);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
});

test("different codes resolve different installation settings, with no fixed sync database", async () => {
  const other = {
    projectId: "z".repeat(20),
    publishableKey: "sb_publishable_other",
  };
  const { handler, calls } = setup([configuration, other, null]);
  for (const [code, expected] of [
    ["KMTPXR", configuration],
    ["ABCDEF", other],
    ["EXPIRE", null],
  ]) {
    const result = await handler(request({ action: "resolve", code }));
    assert.deepEqual(await result.json(), { configuration: expected });
  }
  assert.equal(calls.length, 3);
  assert.equal(
    calls.every(
      (call) =>
        call.url ===
        "https://central.example/rest/v1/rpc/watchmarker_directory_resolve",
    ),
    true,
  );
});

test("unverified, expired and excessive-lifetime invitations are never registered", async () => {
  for (const response of [
    null,
    {},
    { ...registration, issuer: "bad" },
    { ...registration, expiresAt: new Date(now - 1).toISOString() },
    { ...registration, expiresAt: new Date(now + 600_001).toISOString() },
  ]) {
    const { handler, calls } = setup([response]);
    assert.equal(
      (
        await handler(
          request({ action: "register", code: "KMTPXR", configuration, proof }),
        )
      ).status,
      400,
    );
    assert.equal(calls.length, 1);
  }
});

test("invalid codes, privileged keys, arbitrary hosts and oversized bodies fail before network access", async () => {
  const valid = { action: "register", code: "KMTPXR", configuration, proof };
  for (const payload of [
    { ...valid, code: "123456" },
    { ...valid, proof: "weak" },
    {
      ...valid,
      configuration: { ...configuration, projectId: "attacker.example" },
    },
    {
      ...valid,
      configuration: { ...configuration, publishableKey: "sb_secret_server" },
    },
    { ...valid, extra: "a".repeat(4096) },
  ]) {
    const { handler, calls } = setup();
    assert.equal((await handler(request(payload))).status, 400);
    assert.equal(calls.length, 0);
  }
});

test("collisions return false and source/network errors never expose secrets", async () => {
  const { handler } = setup([registration, false]);
  assert.deepEqual(
    await (
      await handler(
        request({ action: "register", code: "KMTPXR", configuration, proof }),
      )
    ).json(),
    { registered: false },
  );
  const failed = createDirectoryHandler({
    url: "https://central.example",
    serviceKey: "server-only",
    fetch: async () => {
      throw new Error("server-only private diagnostic");
    },
  });
  const result = await failed(request({ action: "resolve", code: "KMTPXR" }));
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), {
    error: "Pairing directory unavailable",
  });
  assert.equal(
    (
      await handler(
        new Request("https://directory.example/", { method: "OPTIONS" }),
      )
    ).status,
    204,
  );
  assert.equal(
    (await handler(new Request("https://directory.example/"))).status,
    405,
  );
});

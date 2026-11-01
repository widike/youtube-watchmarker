import assert from "node:assert/strict";
import test from "node:test";
import { credentialStorage } from "./credential-storage.js";
import { SupabaseAuthClient } from "./supabase-auth-client.js";

for (const status of [undefined, 429, 500, 503, 400, 401]) {
  test(`refresh failure ${status || "offline"} ${status === 400 || status === 401 ? "requires sign-in" : "retains the session for automatic retry"}`, async (t) => {
    const client = new SupabaseAuthClient();
    t.mock.method(credentialStorage, "getSession", async () => ({
      refreshToken: "refresh",
      userId: "owner",
    }));
    const clear = t.mock.method(
      credentialStorage,
      "clearSession",
      async () => {},
    );
    t.mock.method(client, "request", async () => {
      throw Object.assign(new Error("unavailable"), { status });
    });
    await assert.rejects(client.refreshSession(), /could not be refreshed/);
    assert.equal(
      clear.mock.callCount(),
      status === 400 || status === 401 ? 1 : 0,
    );
  });
}

test("concurrent refresh attempts share one refresh token request", async (t) => {
  const client = new SupabaseAuthClient();
  t.mock.method(credentialStorage, "getSession", async () => ({
    refreshToken: "refresh",
    userId: "owner",
    historyOwnerId: "shared-history",
  }));
  t.mock.method(credentialStorage, "storeSession", async () => {});
  const request = t.mock.method(client, "request", async () => ({
    access_token: "new-access",
    refresh_token: "new-refresh",
    expires_in: 3600,
    user: { id: "owner" },
  }));
  const sessions = await Promise.all([
    client.refreshSession(),
    client.refreshSession(),
    client.refreshSession(),
  ]);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(sessions[0].accessToken, "new-access");
  assert.equal(sessions[0].userId, "owner");
  assert.equal(sessions[0].historyOwnerId, "shared-history");
});

test("new device uses anonymous Auth without email, password, or copied refresh tokens", async (t) => {
  const client = new SupabaseAuthClient();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({
      access_token: "device-access",
      refresh_token: "device-refresh",
      expires_in: 3600,
      user: { id: "new-device" },
    });
  });
  const configuration = {
    supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
    publishableKey: "sb_publishable_public",
  };
  const session = await client.createDeviceSession(configuration);
  assert.equal(requests[0].url, configuration.supabaseUrl + "/auth/v1/signup");
  assert.deepEqual(JSON.parse(requests[0].body), {});
  assert.equal(requests[0].headers.apikey, configuration.publishableKey);
  assert.equal(session.userId, "new-device");
});

test("malformed Auth replies cannot become stored device sessions", () => {
  const client = new SupabaseAuthClient();
  const valid = {
    access_token: "access",
    refresh_token: "refresh",
    user: { id: "device" },
    expires_in: 3600,
  };
  for (const change of [
    { access_token: null },
    { access_token: {} },
    { refresh_token: "" },
    { user: {} },
    { expires_in: 0 },
    { expires_in: "3600" },
    { expires_in: Infinity },
  ]) {
    assert.throws(
      () => client.createStoredSession({ ...valid, ...change }),
      /incomplete Auth session/,
    );
  }
});

test("refresh cannot silently replace the device identity or save its tokens", async (t) => {
  const client = new SupabaseAuthClient();
  t.mock.method(credentialStorage, "getSession", async () => ({
    refreshToken: "existing-refresh",
    userId: "existing-device",
    historyOwnerId: "shared-history",
  }));
  const stored = t.mock.method(
    credentialStorage,
    "storeSession",
    async () => {},
  );
  const cleared = t.mock.method(
    credentialStorage,
    "clearSession",
    async () => {},
  );
  t.mock.method(client, "request", async () => ({
    access_token: "other-access",
    refresh_token: "other-refresh",
    expires_in: 3600,
    user: { id: "other-device" },
  }));
  await assert.rejects(client.refreshSession(), /different device identity/);
  assert.equal(stored.mock.callCount(), 0);
  assert.equal(cleared.mock.callCount(), 0);
});

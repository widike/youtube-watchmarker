import assert from "node:assert/strict";
import test from "node:test";
import { credentialStorage } from "../extension/providers/credential-storage.js";
import { databaseProviderFactory } from "../extension/providers/database-provider-factory.js";
import { supabaseAuthClient } from "../extension/providers/supabase-auth-client.js";
import { supabaseDatabaseProvider } from "../extension/providers/supabase-database-provider.js";
import {
  handleSupabaseConnect,
  handleSupabaseCreateLink,
} from "../extension/handlers/provider-handlers.js";
import { encodeConnection } from "../extension/providers/device-link.js";

const configuration = {
  projectId: "abcdefghijklmnopqrst",
  publishableKey: "sb_publishable_public",
};
const token = "KMTPXR";
const owner = "00000000-0000-0000-0000-000000000001";

function setup(t) {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ configuration }),
  );
  const previous = databaseProviderFactory.sync;
  databaseProviderFactory.sync = { running: null };
  t.after(() => {
    databaseProviderFactory.sync = previous;
  });
  t.mock.method(credentialStorage, "getConfiguration", async () => null);
  t.mock.method(credentialStorage, "getSession", async () => null);
  const stored = t.mock.method(
    credentialStorage,
    "storeAuthenticatedConfiguration",
    async () => {},
  );
  t.mock.method(databaseProviderFactory, "canCreateHistory", async () => true);
  const identity = t.mock.method(
    databaseProviderFactory,
    "assertIdentity",
    async () => {},
  );
  t.mock.method(databaseProviderFactory, "performDeltaSync", async () => {});
  t.mock.method(supabaseDatabaseProvider, "close", async () => {});
  const create = t.mock.method(
    supabaseAuthClient,
    "createDeviceSession",
    async () => ({
      userId: "new-device",
      accessToken: "device-access",
      refreshToken: "device-refresh",
    }),
  );
  const rpc = t.mock.method(supabaseAuthClient, "deviceRpc", async () => owner);
  return { stored, create, rpc, identity };
}

test("first device creates an independent session with public configuration only", async (t) => {
  const { stored, rpc } = setup(t);
  const result = await handleSupabaseConnect({ configuration });
  assert.equal(result.success, true);
  assert.equal(rpc.mock.calls[0].arguments[2], "watchmarker_history_owner");
  assert.equal(
    stored.mock.calls[0].arguments[1].refreshToken,
    "device-refresh",
  );
  assert.equal(stored.mock.calls[0].arguments[1].historyOwnerId, owner);
});

test("another device discovers the public project and redeems a short code", async (t) => {
  const { stored, rpc, identity } = setup(t);
  const result = await handleSupabaseConnect({
    connectionCode: encodeConnection(token),
  });
  assert.equal(result.success, true);
  assert.equal(rpc.mock.calls[0].arguments[2], "watchmarker_claim_link");
  assert.deepEqual(rpc.mock.calls[0].arguments[3], { p_token: token });
  assert.equal(
    stored.mock.calls[0].arguments[0].projectId,
    configuration.projectId,
  );
  assert.equal(identity.mock.calls[0].arguments[1].historyOwnerId, owner);
  assert.equal(stored.mock.calls[0].arguments[1].userId, "new-device");
});

test("a consumed or expired invitation cannot replace saved credentials", async (t) => {
  const { stored } = setup(t);
  t.mock.method(supabaseAuthClient, "deviceRpc", async () => null);
  const result = await handleSupabaseConnect({
    connectionCode: encodeConnection(token),
  });
  assert.equal(result.success, false);
  assert.equal(stored.mock.callCount(), 0);
});

test("an established history cannot accidentally start a new cloud identity", async (t) => {
  const { create, stored } = setup(t);
  t.mock.method(databaseProviderFactory, "canCreateHistory", async () => false);
  const result = await handleSupabaseConnect({ configuration });
  assert.equal(result.success, false);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(stored.mock.callCount(), 0);
});

test("invalid or old codes cannot trigger discovery or account creation", async (t) => {
  const { create, stored } = setup(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Must not fetch");
  });
  const result = await handleSupabaseConnect({
    connectionCode: "watchmarker:1:old",
  });
  assert.equal(result.success, false);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
  assert.equal(stored.mock.callCount(), 0);
});

test("short codes register the issuing installation without sending its Auth tokens to the directory", async (t) => {
  setup(t);
  t.mock.method(
    credentialStorage,
    "getConfiguration",
    async () => configuration,
  );
  t.mock.method(credentialStorage, "getSession", async () => ({
    accessToken: "device-private",
  }));
  t.mock.method(
    supabaseAuthClient,
    "getAccessToken",
    async () => "device-private",
  );
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ registered: true });
  });
  t.mock.method(supabaseAuthClient, "deviceRpc", async () => ({
    code: token,
    proof: "a".repeat(64),
  }));
  const result = await handleSupabaseCreateLink();
  assert.equal(result.success, true);
  assert.equal(result.connectionCode, "KMT-PXR");
  assert.deepEqual(JSON.parse(requests[0].body).configuration, configuration);
  assert.equal(requests[0].body.includes("device-private"), false);
  assert.equal(requests[0].headers.Authorization, undefined);
});

test("directory collisions cause a new source invitation to be generated", async (t) => {
  setup(t);
  t.mock.method(
    credentialStorage,
    "getConfiguration",
    async () => configuration,
  );
  t.mock.method(credentialStorage, "getSession", async () => ({}));
  t.mock.method(supabaseAuthClient, "getAccessToken", async () => "private");
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ registered: ++attempts > 1 }),
  );
  const rpc = t.mock.method(supabaseAuthClient, "deviceRpc", async () => ({
    code: token,
    proof: "a".repeat(64),
  }));
  assert.equal((await handleSupabaseCreateLink()).connectionCode, "KMT-PXR");
  assert.equal(rpc.mock.callCount(), 2);
});

import assert from "node:assert/strict";
import test from "node:test";
import { credentialStorage } from "./credential-storage.js";
import { databaseProviderFactory } from "./database-provider-factory.js";
import { supabaseAuthClient } from "./supabase-auth-client.js";
import { supabaseDatabaseProvider } from "./supabase-database-provider.js";
import { handleSupabaseConnect } from "./handlers/provider-handlers.js";
import { encodeConnection } from "./device-link.js";

const configuration = {
  projectId: "abcdefghijklmnopqrst",
  publishableKey: "sb_publishable_public",
};
const token = "a".repeat(64);
const owner = "00000000-0000-0000-0000-000000000001";

function setup(t) {
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

test("another device imports the project and shared owner from the connection code", async (t) => {
  const { stored, rpc, identity } = setup(t);
  const result = await handleSupabaseConnect({
    connectionCode: encodeConnection(configuration, token),
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
  t.mock.method(supabaseAuthClient, "deviceRpc", async () => {
    throw new Error("Connection code expired or already used");
  });
  const result = await handleSupabaseConnect({
    connectionCode: encodeConnection(configuration, token),
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

import test from "node:test";
import assert from "node:assert/strict";
import { reconciliationCloudStatus } from "../extension/history/history-repair-sync.js";
import { credentialStorage } from "../extension/providers/credential-storage.js";
import { databaseProviderFactory } from "../extension/providers/database-provider-factory.js";
import { Database } from "../extension/background/bg-database.js";
import { handleHistoryReconciliation } from "../extension/handlers/reconciliation-handlers.js";

test("cloud readiness requires identity, completed sync and the reconciliation SQL contract", async (t) => {
  t.mock.method(credentialStorage, "getConfiguration", async () => ({
    projectId: "fixture",
  }));
  t.mock.method(credentialStorage, "getSession", async () => ({
    userId: "fixture",
  }));
  const factory = {
    isConfigured: async () => true,
    assertIdentity: async () => {},
    getProviderStatus: async () => ({ lastSuccess: 1 }),
  };
  const calls = [];
  const remote = {
    makeRequest: async (...args) => {
      calls.push(args);
      return new Response("1");
    },
  };
  assert.equal((await reconciliationCloudStatus(factory, remote)).ready, true);
  assert.deepEqual(calls[0], [
    "POST",
    "/rpc/watchmarker_import_reconciliation_version",
    {},
  ]);
  remote.makeRequest = async () => new Response("0");
  assert.equal((await reconciliationCloudStatus(factory, remote)).ready, false);
  factory.getProviderStatus = async () => ({
    lastSuccess: 1,
    inProgress: true,
  });
  assert.equal((await reconciliationCloudStatus(factory, remote)).ready, false);
  factory.assertIdentity = async () => {
    throw new Error("Wrong owner");
  };
  assert.equal((await reconciliationCloudStatus(factory, remote)).ready, false);
});

test("approval without a usable Supabase connection performs no database write", async (t) => {
  t.mock.method(databaseProviderFactory, "isConfigured", async () => false);
  const previous = Database.database;
  let writes = 0;
  Database.database = {
    transaction: () => {
      writes++;
      throw new Error("Unexpected database access");
    },
  };
  t.after(() => (Database.database = previous));
  const response = await handleHistoryReconciliation({
    operation: "approve",
    planId: "preview-token",
  });
  assert.equal(response.success, false);
  assert.match(response.error, /Supabase/);
  assert.equal(writes, 0);
});

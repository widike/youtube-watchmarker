import test from "node:test";
import assert from "node:assert/strict";
import { SearchManager } from "../extension/background/bg-search.js";
import { SupabaseDatabaseProvider } from "../extension/providers/supabase-database-provider.js";

function fixture(cloud = { success: true }) {
  const calls = [];
  const manager = new SearchManager();
  manager.setProviderFactory({
    getCurrentProvider: () => ({
      deleteVideo: async (...args) => calls.push(["local", ...args]),
    }),
    syncVideoDeletion: async (id) => {
      calls.push(["cloud", id]);
      return cloud;
    },
    isConfigured: async () => true,
  });
  return { manager, calls };
}

test("trash commits local deletion before syncing Supabase", async () => {
  const { manager, calls } = fixture();
  assert.deepEqual(await manager.delete("aaaaaaaaaaa"), {
    success: true,
    deleted: true,
  });
  assert.deepEqual(calls, [
    ["local", "aaaaaaaaaaa"],
    ["cloud", "aaaaaaaaaaa"],
  ]);
});

test("cloud failure preserves local deletion and reports its retry", async () => {
  const { manager } = fixture({ success: false, error: "offline" });
  const result = await manager.delete("aaaaaaaaaaa");
  assert.equal(result.success, false);
  assert.equal(result.deleted, true);
  assert.match(result.error, /Supabase.*offline/);
});

test("invalid IDs have no side effects", async () => {
  const { manager, calls } = fixture();
  await assert.rejects(manager.delete("bad"), /Invalid/);
  assert.deepEqual(calls, []);
});

test("Supabase receives the deletion marker and only acknowledges after event writes", async () => {
  const provider = new SupabaseDatabaseProvider();
  const requests = [];
  provider.makeRequest = async (...args) => {
    requests.push(args);
  };
  assert.equal(
    await provider.importVideos([
      {
        strIdent: "aaaaaaaaaaa",
        strTitle: "Title",
        intTimestamp: 10,
        intDeletedAt: 20,
      },
    ]),
    true,
  );
  assert.equal(requests[0][0], "POST");
  assert.equal(requests[0][2][0].int_deleted_at, 20);
  assert.equal(requests[1][2][0].str_ident, "aaaaaaaaaaa");
  provider.makeRequest = async (_method, path) => {
    if (path.startsWith("/youtube_watch_events"))
      throw new Error("Events unavailable");
  };
  await assert.rejects(
    provider.importVideos([
      {
        strIdent: "aaaaaaaaaaa",
        intTimestamp: 10,
        intDeletedAt: 20,
      },
    ]),
    /Events unavailable/,
  );
});

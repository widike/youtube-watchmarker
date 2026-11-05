import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseDatabaseProvider } from "../extension/providers/supabase-database-provider.js";

const event = (eventId, watchedAt) => ({
  eventId,
  watchedAt,
  source: "playback",
  precision: "exact",
  observedDeletion: 0,
});
const row = (strIdent) => ({
  str_ident: strIdent,
  int_timestamp: 200,
  int_count: 2,
  int_imported_count: 0,
});

test("uploads append immutable events after summaries and retry stable IDs", async () => {
  const provider = new SupabaseDatabaseProvider();
  const calls = [];
  let offline = true;
  provider.makeRequest = async (...args) => {
    calls.push(args);
    if (args[1].startsWith("/youtube_watch_events") && offline)
      throw new Error("offline");
    return new Response("");
  };
  const video = {
    strIdent: "abcdefghijk",
    intTimestamp: 200,
    intImportedCount: 0,
    watchEvents: [event("first", 100), event("second", 200)],
  };
  await assert.rejects(provider.importVideos([video]), /offline/);
  assert.match(calls[0][1], /^\/youtube_watch_history/);
  assert.match(calls[1][3], /merge-duplicates/);
  offline = false;
  await provider.importVideos([video]);
  assert.deepEqual(calls[1][2], calls[3][2]);
  assert.deepEqual(
    calls[3][2].map((watch) => watch.watched_at),
    [100, 200],
  );
});

test("incremental pages include complete event histories in one response", async () => {
  const provider = new SupabaseDatabaseProvider();
  const calls = [];
  provider.makeRequest = async (...args) => {
    calls.push(args);
    return Response.json([
      { ...row("aaaaaaaaaaa"), watch_events: [event("same-id", 100)] },
      { ...row("bbbbbbbbbbb"), watch_events: [event("same-id", 200)] },
    ]);
  };
  const videos = await provider.getVideoPage("", 500, {
    since: "2",
    until: "9",
  });
  assert.equal(videos.length, 2);
  assert.equal(videos[0].watchEvents[0].watchedAt, 100);
  assert.equal(videos[1].watchEvents[0].watchedAt, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "POST",
    "/rpc/watchmarker_sync_page",
    {
      p_collection: "history",
      p_since: "2",
      p_until: "9",
      p_after: "",
      p_limit: 500,
    },
  ]);
});

test("schema 4 is required before cloud synchronization can run", async () => {
  const provider = new SupabaseDatabaseProvider();
  provider.makeRequest = async () => new Response("2");
  await assert.rejects(provider.init(), /Unsupported sync schema/);
  provider.makeRequest = async (_method, path) =>
    path.endsWith("watchmarker_sync_state")
      ? Response.json({ version: 1, owner: "owner", revisions: {} })
      : new Response(
          path.endsWith("watchmarker_event_merge_version") ? "1" : "4",
        );
  await provider.init();
  assert.equal(provider.isConnected, true);
});

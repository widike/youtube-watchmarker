import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseDatabaseProvider } from "./supabase-database-provider.js";

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
  assert.match(calls[1][3], /ignore-duplicates/);
  offline = false;
  await provider.importVideos([video]);
  assert.deepEqual(calls[1][2], calls[3][2]);
  assert.deepEqual(
    calls[3][2].map((watch) => watch.watched_at),
    [100, 200],
  );
});

test("downloads paginate event histories without truncating a repeated ID at a boundary", async () => {
  const provider = new SupabaseDatabaseProvider();
  const calls = [];
  let page = 0;
  provider.makeRequest = async (_method, path) => {
    calls.push(path);
    if (path.startsWith("/youtube_watch_history"))
      return new Response(
        JSON.stringify([row("aaaaaaaaaaa"), row("bbbbbbbbbbb")]),
      );
    const batches = [
      [
        {
          str_ident: "aaaaaaaaaaa",
          event_id: "same-id",
          watched_at: 100,
          source: "playback",
          precision: "exact",
        },
      ],
      [
        {
          str_ident: "bbbbbbbbbbb",
          event_id: "same-id",
          watched_at: 200,
          source: "playback",
          precision: "exact",
        },
      ],
      [],
    ];
    return new Response(JSON.stringify(batches[page++]));
  };
  const videos = await provider.getVideoPage();
  assert.equal(videos.length, 2);
  assert.equal(videos[0].watchEvents[0].watchedAt, 100);
  assert.equal(videos[1].watchEvents[0].watchedAt, 200);
  const cursor = new URL(`https://example.test${calls[2]}`).searchParams.get(
    "or",
  );
  assert.match(cursor, /event_id\.eq\."same-id"/);
  assert.match(cursor, /str_ident\.gt\."aaaaaaaaaaa"/);
});

test("schema 4 is required before cloud synchronization can run", async () => {
  const provider = new SupabaseDatabaseProvider();
  provider.makeRequest = async () => new Response("2");
  await assert.rejects(provider.init(), /Unsupported sync schema/);
  provider.makeRequest = async () => new Response("4");
  await provider.init();
  assert.equal(provider.isConnected, true);
});

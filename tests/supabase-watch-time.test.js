import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseDatabaseProvider } from "../extension/providers/supabase-database-provider.js";
import {
  timeToRow,
  timeFromRow,
} from "../extension/providers/supabase-watch-time.js";
import { mergeWatchTime } from "../extension/history/watch-time-records.js";

const row = {
  snapshotId: "shared-play:180000",
  eventId: "playback:shared-play",
  strIdent: "abcdefghijk",
  strTitle: "Space",
  minute: 180000,
  from: 180000,
  to: 182000,
  milliseconds: 2000,
  observedDeletion: 0,
  eventWatchedAt: 180000,
  durationSeconds: 120,
  mediaRanges: [[0, 2]],
};
test("duration transport preserves stable identities, coverage, and event dates across replicas", async () => {
  assert.deepEqual(timeFromRow(timeToRow(row)), row);
  const provider = new SupabaseDatabaseProvider();
  const calls = [];
  provider.makeRequest = async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify([timeToRow(row)]));
  };
  await provider.importWatchTime([row]);
  const rows = await provider.getWatchTimePage("a:b%?", 500, {
    since: "2",
    until: "4",
  });
  assert.deepEqual(rows, [row]);
  assert.equal(calls[0][0], "POST");
  assert.match(calls[0][1], /on_conflict=user_id,snapshot_id/);
  assert.deepEqual(calls[1], [
    "POST",
    "/rpc/watchmarker_sync_page",
    {
      p_collection: "watchTime",
      p_since: "2",
      p_until: "4",
      p_after: "a:b%?",
      p_limit: 500,
    },
  ]);
});
test("duration merges take the cumulative maximum and reject identity corruption", () => {
  assert.deepEqual(mergeWatchTime(row, { ...row, milliseconds: 1000 }), row);
  assert.equal(
    mergeWatchTime(row, { ...row, to: 183000, milliseconds: 3000 })
      .milliseconds,
    3000,
  );
  assert.throws(
    () => mergeWatchTime(row, { ...row, strIdent: "mnopqrstuvw" }),
    /Conflicting/,
  );
});

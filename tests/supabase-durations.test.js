import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseDatabaseProvider } from "../extension/providers/supabase-database-provider.js";
import {
  durationToRow,
  durationFromRow,
} from "../extension/providers/supabase-durations.js";
import {
  newerDuration,
  normalizeDuration,
} from "../extension/duration/duration-records.js";

const row = {
  strIdent: "abcdefghijk",
  seconds: 600,
  fetchedAt: 1000,
  expiresAt: 2000,
};
test("duration transport preserves expiry and sends only duration metadata, without credentials", async () => {
  assert.deepEqual(durationFromRow(durationToRow(row)), row);
  const provider = new SupabaseDatabaseProvider();
  const calls = [];
  provider.makeRequest = async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify([durationToRow(row)]));
  };
  await provider.importDurations([
    { ...row, apiKey: "must-not-sync", enabled: true },
  ]);
  assert.deepEqual(calls[0], [
    "POST",
    "/youtube_video_durations?on_conflict=user_id,str_ident",
    [durationToRow(row)],
  ]);
  assert.deepEqual(await provider.getDurationPage("a:b%?"), [row]);
  assert.equal(
    new URL(`https://example.test${calls[1][1]}`).searchParams.get("str_ident"),
    "gt.a:b%?",
  );
  await provider.getDurationPage();
  assert.equal(calls[2][0], "DELETE");
  assert.match(calls[2][1], /expires_at=lte\./);
});
test("duration merges reject invalid metadata and resolve equal dates consistently", () => {
  for (const extra of [
    { seconds: Infinity },
    { seconds: -1 },
    { expiresAt: 999 },
    { fetchedAt: NaN },
    { strIdent: "bad" },
    { seconds: 20, unavailable: true },
  ])
    assert.throws(() => normalizeDuration({ ...row, ...extra }), /Invalid/);
  const newer = { ...row, fetchedAt: 1001, seconds: 900 };
  assert.deepEqual(newerDuration(row, newer), newerDuration(newer, row));
  const sameDate = { ...row, seconds: 800 };
  assert.deepEqual(newerDuration(row, sameDate), newerDuration(sameDate, row));
});
test("connection setup reports the missing duration migration before claiming sync readiness", async () => {
  const provider = new SupabaseDatabaseProvider();
  provider.makeRequest = async (method, path) => {
    if (path.endsWith("watchmarker_sync_version")) return new Response("4");
    throw new Error("Video duration table is missing");
  };
  const status = await provider.checkTableStatus();
  assert.equal(status.exists, false);
  assert.match(status.error, /Connection settings/);
});

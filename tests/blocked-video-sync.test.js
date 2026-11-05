import assert from "node:assert/strict";
import test from "node:test";
import { BlockedVideoStore } from "../extension/background/blocked-videos.js";
import { BlockedVideoSync } from "../extension/background/blocked-video-sync.js";
import {
  compareBlocks,
  normalizeBlock,
} from "../extension/shared/blocked-video-records.js";
import { SupabaseDatabaseProvider } from "../extension/providers/supabase-database-provider.js";

function device(now) {
  const data = {};
  const storage = {
    get: async () => structuredClone(data),
    set: async (updates) => Object.assign(data, structuredClone(updates)),
  };
  return new BlockedVideoStore(storage, now);
}

function remote() {
  const rows = new Map();
  let revision = 0;
  const versions = new Map();
  return {
    rows,
    getSyncState: async () => ({ revisions: { blocked: String(revision) } }),
    async importBlockedVideos(records) {
      for (const value of records) {
        const row = normalizeBlock(value);
        if (
          !rows.has(row.videoId) ||
          compareBlocks(row, rows.get(row.videoId)) > 0
        ) {
          rows.set(row.videoId, row);
          versions.set(row.videoId, ++revision);
        }
      }
      return true;
    },
    async getBlockedVideoPage(after, _limit, window) {
      return [...rows.values()]
        .filter(
          (row) =>
            row.videoId > after &&
            versions.get(row.videoId) > Number(window.since) &&
            versions.get(row.videoId) <= Number(window.until),
        )
        .sort((a, b) => (a.videoId < b.videoId ? -1 : 1))
        .slice(0, 2);
    },
  };
}

test("blocks, offline edits and unblocks converge across devices without resurrecting stale blocks", async () => {
  let time = 100;
  const first = device(() => time);
  const second = device(() => time);
  const cloud = remote();
  const syncA = new BlockedVideoSync(first, cloud);
  const syncB = new BlockedVideoSync(second, cloud);
  await first.update("aaaaaaaaaaa", "First", true);
  await first.update("bbbbbbbbbbb", "Second", true);
  await first.update("ccccccccccc", "Third", true);
  await syncA.sync();
  await syncB.sync();
  assert.equal((await second.list()).length, 3);
  time = 200;
  await second.update("aaaaaaaaaaa", "Old offline block", true);
  time = 300;
  await first.update("aaaaaaaaaaa", "", false);
  await syncA.sync();
  await syncB.sync();
  assert.equal(
    (await second.list()).some((row) => row.videoId === "aaaaaaaaaaa"),
    false,
  );
  assert.equal(cloud.rows.get("aaaaaaaaaaa").blocked, false);
  assert.equal((await second.pendingRecords()).length, 0);
  time = 400;
  await second.update("aaaaaaaaaaa", "Reblock", true);
  await syncB.sync();
  await syncA.sync();
  assert.equal((await first.list())[0].title, "Reblock");
  assert.equal((await new BlockedVideoStore(second.storage).list()).length, 3);
});

test("network failures retain pending edits and acknowledgements cannot erase newer local changes", async () => {
  const store = device(() => 100);
  const cloud = remote();
  const sync = new BlockedVideoSync(store, cloud);
  await store.update("aaaaaaaaaaa", "First", true);
  const upload = cloud.importBlockedVideos.bind(cloud);
  cloud.importBlockedVideos = async () => {
    throw new Error("Offline");
  };
  await assert.rejects(sync.sync(), /Offline/);
  assert.equal((await store.pendingRecords()).length, 1);
  let changed = false;
  cloud.importBlockedVideos = async (rows) => {
    if (!changed) {
      changed = true;
      await store.update("aaaaaaaaaaa", "", false);
    }
    return upload(rows);
  };
  await sync.sync();
  assert.equal(cloud.rows.get("aaaaaaaaaaa").blocked, false);
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await store.pendingRecords(), []);
});

test("equal-clock revisions resolve deterministically and malformed cloud records are rejected", async () => {
  const left = {
    videoId: "aaaaaaaaaaa",
    title: "A",
    blocked: true,
    updatedAt: 1,
    changeId: "00000000-0000-0000-0000-000000000001",
  };
  const right = {
    ...left,
    blocked: false,
    changeId: "00000000-0000-0000-0000-000000000002",
  };
  for (const rows of [
    [left, right],
    [right, left],
  ]) {
    const store = device(Date.now);
    await store.merge(rows);
    assert.deepEqual(await store.list(), []);
    await assert.rejects(store.merge([{ ...left, updatedAt: NaN }]), /Invalid/);
  }
});

test("Supabase transports only block metadata and includes unblock tombstones", async () => {
  const store = device(() => 100);
  await store.update("aaaaaaaaaaa", "Title", true);
  await store.update("aaaaaaaaaaa", "", false);
  const row = (await store.pendingRecords())[0];
  const provider = new SupabaseDatabaseProvider();
  const calls = [];
  provider.makeRequest = async (...args) => {
    calls.push(args);
    return new Response(JSON.stringify(calls[0][2]));
  };
  await provider.importBlockedVideos([
    { ...row, accessToken: "must-not-leak" },
  ]);
  assert.equal(
    calls[0][1],
    "/youtube_blocked_videos?on_conflict=user_id,str_ident",
  );
  assert.equal(calls[0][2][0].blocked, false);
  assert.deepEqual(
    Object.keys(calls[0][2][0]).sort(),
    ["str_ident", "title", "blocked", "updated_at", "change_id"].sort(),
  );
  assert.deepEqual(
    await provider.getBlockedVideoPage("cursor%?", 500, {
      since: "3",
      until: "4",
    }),
    [normalizeBlock(row)],
  );
  assert.equal(calls[1][1], "/rpc/watchmarker_sync_page");
  assert.equal(calls[1][2].p_after, "cursor%?");
});

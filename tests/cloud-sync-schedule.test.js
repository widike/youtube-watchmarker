import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldSync,
  scheduleSync,
} from "../extension/providers/cloud-sync-schedule.js";
import { downloadChanges } from "../extension/providers/sync-window.js";

test("idle polling survives worker restarts and uploads bypass only the idle interval", () => {
  const now = 1_000_000;
  const status = { lastAttempt: now };
  assert.equal(shouldSync(status, { now: now + 30_000, pending: 0 }), false);
  assert.equal(shouldSync(status, { now: now + 30_000, pending: 1 }), true);
  assert.equal(shouldSync(status, { now: now + 300_000, pending: 0 }), true);
  assert.equal(shouldSync(status, { now: now - 1, pending: 0 }), true);
  assert.equal(shouldSync(status, { now, force: true }), true);
});

test("failures persist exponential backoff, including for pending uploads; success clears it", () => {
  let status = {};
  let now = 1_000_000;
  for (const delay of [
    60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000,
  ]) {
    status = scheduleSync(status, { success: false }, now);
    assert.equal(status.retryAt - now, delay);
    assert.equal(shouldSync(status, { now: now + 30_000, pending: 1 }), false);
    now = status.retryAt;
    assert.equal(shouldSync(status, { now, pending: 1 }), true);
    assert.equal(shouldSync(status, { now, pending: 0 }), true);
  }
  status = scheduleSync(status, { success: true }, now);
  assert.equal(status.retryAt, 0);
  assert.equal(status.failures, 0);
});

test("delta windows resume after failed merges, retain bigint precision, and do not reread unchanged data", async () => {
  const values = new Map();
  const storage = {
    get: async (key) => structuredClone(values.get(key)),
    set: async (key, value) => values.set(key, structuredClone(value)),
  };
  const latest = "9007199254740999";
  let fail = true;
  const seen = [];
  const options = {
    storage,
    collection: "history",
    latest,
    key: (row) => row.id,
    now: () => 1,
    deadline: 100,
    page: async (after, _limit, window) => {
      seen.push({ after, ...window });
      return after === "b" ? [] : [{ id: "b" }];
    },
    merge: async () => {
      if (fail) throw new Error("Disk failed");
    },
  };
  await assert.rejects(downloadChanges(options), /Disk failed/);
  assert.equal(values.get("syncWindow:history").after, "");
  fail = false;
  const result = await downloadChanges(options);
  assert.deepEqual(result, { downloaded: 1, complete: true });
  assert.equal(values.get("syncWindow:history").since, latest);
  const count = seen.length;
  await downloadChanges(options);
  assert.equal(seen.length, count);
  await assert.rejects(
    downloadChanges({ ...options, latest: "2" }),
    /moved backwards/,
  );
});

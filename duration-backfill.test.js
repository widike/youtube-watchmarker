import test from "node:test";
import assert from "node:assert/strict";
import { DurationBackfill } from "./duration-backfill.js";
import {
  DurationRequestError,
  fetchDurations,
  DURATION_TTL,
  nextQuotaReset,
  pacificDay,
} from "./duration-api.js";

function setup(count = 121) {
  let now = Date.parse("2026-11-01T12:00:00Z");
  let config = { enabled: true, apiKey: "encrypted-key" };
  let state = {};
  let cache = [];
  let scheduled;
  const calls = [];
  const videos = Array.from({ length: count }, (_, n) => ({
    strIdent: String(n).padStart(11, "a"),
    strTitle: "Video",
    intTimestamp: now - (count - n) * 1000,
    intCount: 1,
  }));
  const storage = {
    getConfig: async () => structuredClone(config),
    saveConfig: async (value) => {
      config = structuredClone(value);
    },
    getState: async () => structuredClone(state),
    saveState: async (value) => {
      state = structuredClone(value);
    },
    getKey: async () => "plain-key",
    encryptKey: async (key) => `encrypted:${key}`,
    readCache: async () => {
      cache = cache.filter((row) => row.unavailable || row.expiresAt > now);
      return structuredClone(cache);
    },
    writeCache: async (rows) => {
      cache = [
        ...cache.filter(
          (row) => !rows.some((next) => next.strIdent === row.strIdent),
        ),
        ...rows,
      ];
    },
    clearCache: async () => {
      cache = [];
    },
  };
  const dependencies = {
    storage,
    getVideos: async () => videos,
    clock: () => now,
    random: () => 0,
    schedule: async (when) => {
      scheduled = when;
    },
    clear: async () => {
      scheduled = null;
    },
    fetchBatch: async (ids, key) => {
      calls.push({ ids, key });
      return ids.map((strIdent) => ({
        strIdent,
        seconds: 600,
        fetchedAt: now,
        expiresAt: now + DURATION_TTL,
      }));
    },
  };
  return {
    dependencies,
    videos,
    calls,
    storage,
    advance: (ms) => {
      now += ms;
    },
    get state() {
      return state;
    },
    get config() {
      return config;
    },
    get cache() {
      return cache;
    },
    get now() {
      return now;
    },
    get scheduled() {
      return scheduled;
    },
  };
}

test("backfill batches 50 unique IDs newest first and resumes remaining work after worker restart", async () => {
  const fixture = setup();
  let job = new DurationBackfill(fixture.dependencies);
  await Promise.all([job.tick(), job.tick()]);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].ids.length, 50);
  assert.equal(fixture.calls[0].ids[0], fixture.videos.at(-1).strIdent);
  fixture.advance(30_000);
  job = new DurationBackfill(fixture.dependencies);
  await job.initialize();
  await job.tick();
  assert.equal(fixture.calls[1].ids[0], fixture.videos.at(-51).strIdent);
  fixture.advance(30_000);
  await job.tick();
  assert.equal(fixture.calls[2].ids.length, 21);
  assert.equal(new Set(fixture.calls.flatMap(({ ids }) => ids)).size, 121);
  fixture.advance(30_000);
  await job.tick();
  assert.equal(fixture.state.status, "complete");
  assert.equal((await job.status()).remaining, 0);
  assert.equal((await job.status()).available, 121);
  assert(!JSON.stringify(await job.status()).includes("key"));
});

test("fresh positive and negative caches avoid requests; expiry refreshes durations", async () => {
  const fixture = setup(3);
  await fixture.storage.writeCache([
    {
      strIdent: fixture.videos[2].strIdent,
      seconds: null,
      expiresAt: fixture.now + 60_000,
    },
  ]);
  const job = new DurationBackfill(fixture.dependencies);
  await job.tick();
  assert.equal(fixture.calls[0].ids.length, 2);
  fixture.advance(30_000);
  await job.tick();
  assert.equal(fixture.calls.length, 1);
  assert.equal((await job.status()).unavailable, 1);
  fixture.advance(DURATION_TTL + 3_600_000);
  await job.tick();
  assert.equal(fixture.calls[1].ids.length, 3);
});

test("missing videos stay skipped beyond metadata expiry and worker restarts", async () => {
  const fixture = setup(3);
  const missing = fixture.videos[2].strIdent;
  fixture.dependencies.fetchBatch = (ids, key, options) =>
    fetchDurations(ids, key, {
      ...options,
      fetcher: async () => {
        fixture.calls.push(ids);
        return Response.json({
          items: ids
            .filter((id) => id !== missing)
            .map((id) => ({ id, contentDetails: { duration: "PT10M" } })),
        });
      },
    });
  let job = new DurationBackfill(fixture.dependencies);
  await job.tick();
  fixture.advance(DURATION_TTL + 60_000);
  job = new DurationBackfill(fixture.dependencies);
  await job.initialize();
  await job.control({ command: "start" });
  fixture.advance(30_000);
  await job.tick();
  assert.equal(fixture.calls.length, 2);
  assert(!fixture.calls[1].includes(missing));
  fixture.advance(30_000);
  await job.tick();
  const status = await job.status();
  assert.equal(status.status, "complete");
  assert.equal(status.unavailable, 1);
  assert.equal(status.remaining, 0);
  assert.equal(fixture.videos.length, 3);
  await job.control({ command: "forget" });
  await job.control({ command: "start", apiKey: "x".repeat(30) });
  fixture.advance(30_000);
  await job.tick();
  assert(fixture.calls.at(-1).includes(missing));
});

test("batch not-found errors isolate missing videos with paced, budgeted requests across restarts", async () => {
  const fixture = setup(4);
  const missing = fixture.videos[2].strIdent;
  fixture.dependencies.fetchBatch = (ids, key, options) =>
    fetchDurations(ids, key, {
      ...options,
      fetcher: async () => {
        fixture.calls.push({ ids, at: fixture.now });
        return ids.includes(missing)
          ? Response.json(
              { error: { errors: [{ reason: "videoNotFound" }] } },
              { status: 404 },
            )
          : Response.json({
              items: ids.map((id) => ({
                id,
                contentDetails: { duration: "PT10M" },
              })),
            });
      },
    });
  for (let attempt = 0; attempt < 8; attempt++) {
    const job = new DurationBackfill(fixture.dependencies);
    await job.initialize();
    await job.tick();
    if (fixture.state.status === "complete") break;
    fixture.advance(30_000);
  }
  const status = await new DurationBackfill(fixture.dependencies).status();
  assert.equal(status.status, "complete");
  assert.equal(status.available, 3);
  assert.equal(status.unavailable, 1);
  assert.equal(status.requestsToday, fixture.calls.length);
  for (let index = 1; index < fixture.calls.length; index++)
    assert(fixture.calls[index].at - fixture.calls[index - 1].at >= 30_000);
  assert.deepEqual(
    fixture.cache.filter((row) => row.unavailable).map((row) => row.strIdent),
    [missing],
  );
});

test("server Retry-After survives restarts and repeated Resume cannot bypass it", async () => {
  const fixture = setup(1);
  const deadline = fixture.now + 600_000;
  fixture.dependencies.fetchBatch = async () => {
    fixture.calls.push(1);
    throw new DurationRequestError("rate", "throttle", deadline);
  };
  let job = new DurationBackfill(fixture.dependencies);
  await job.tick();
  assert.equal(fixture.state.status, "retry");
  assert.equal(fixture.scheduled, deadline);
  fixture.advance(30_000);
  job = new DurationBackfill(fixture.dependencies);
  await job.control({ command: "pause" });
  await job.control({ command: "start" });
  await job.tick();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.scheduled, deadline);
  assert.equal(fixture.state.status, "retry");
});

test("resuming an idle completed job queues newly imported videos without waiting for the hourly check", async () => {
  const fixture = setup(1);
  const job = new DurationBackfill(fixture.dependencies);
  await job.tick();
  fixture.advance(30_000);
  await job.tick();
  assert.equal(fixture.state.status, "complete");
  fixture.videos.push({
    ...fixture.videos[0],
    strIdent: "newest_____",
    intTimestamp: fixture.now,
  });
  await job.control({ command: "start" });
  assert.equal(fixture.scheduled, fixture.now + 30_000);
  fixture.advance(30_000);
  await job.tick();
  assert.deepEqual(fixture.calls.at(-1).ids, ["newest_____"]);
});

test("quota and local budget pause until Pacific reset without spending requests", async () => {
  for (const localBudget of [false, true]) {
    const fixture = setup(1);
    fixture.dependencies.fetchBatch = async () => {
      fixture.calls.push(1);
      throw new DurationRequestError("quota", "quota");
    };
    if (localBudget)
      await fixture.storage.saveState({
        day: pacificDay(fixture.now),
        requestsToday: 1000,
      });
    const job = new DurationBackfill(fixture.dependencies);
    await job.tick();
    assert.equal(fixture.state.status, "quota");
    assert.equal(fixture.scheduled, nextQuotaReset(fixture.now));
    assert.equal(fixture.calls.length, localBudget ? 0 : 1);
  }
});

test("repeated transient failures stop after six attempts; configuration failures stop immediately", async () => {
  const fixture = setup(1);
  fixture.dependencies.fetchBatch = async () => {
    fixture.calls.push(1);
    throw new DurationRequestError("transient", "offline");
  };
  const job = new DurationBackfill(fixture.dependencies);
  let previous = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    await job.tick();
    if (attempt < 5) {
      const delay = fixture.scheduled - fixture.now;
      assert(delay >= Math.max(30_000, previous * 2));
      previous = delay;
      fixture.advance(delay);
    }
  }
  assert.equal(fixture.state.status, "error");
  assert.equal(fixture.scheduled, null);
  await job.tick();
  assert.equal(fixture.calls.length, 6);
  job.fetchBatch = async () => {
    throw new DurationRequestError("configuration", "bad key");
  };
  await job.control({ command: "start" });
  fixture.advance(30_000);
  await job.tick();
  assert.equal(fixture.state.status, "error");
  assert.equal(fixture.state.failures, 1);
});

test("pause and forget prevent further requests; forget removes key/cache but preserves quota accounting", async () => {
  const fixture = setup(3);
  const job = new DurationBackfill(fixture.dependencies);
  await job.tick();
  const budget = fixture.state.requestsToday;
  await job.control({ command: "pause" });
  fixture.advance(60_000);
  await job.tick();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.cache.length, 3);
  await job.control({ command: "forget" });
  assert.equal(fixture.cache.length, 0);
  assert.equal(fixture.config.apiKey, undefined);
  assert.equal(fixture.state.requestsToday, budget);
  await assert.rejects(job.control({ command: "start" }), /key is required/);
  await assert.rejects(
    job.control({ command: "start", apiKey: 123 }),
    /valid YouTube/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { createHistorySynchronization } from "../../extension/background/history-synchronization.js";

function setup(overrides = {}) {
  const calls = [];
  const sync = createHistorySynchronization({
    ready: async () => {
      calls.push("ready");
    },
    storage: {
      get: async () => {
        calls.push("settings");
        return { idCondition_Youhist: true, idCondition_Browhist: false };
      },
    },
    youtube: {
      synchronize: async () => {
        calls.push("youtube");
      },
    },
    history: {
      synchronize: async () => {
        throw new Error("History unavailable");
      },
    },
    logger: {
      debug() {},
      info() {},
      error: () => {
        calls.push("error");
      },
    },
    ...overrides,
  });
  return { sync, calls };
}

test("startup waits for providers and settings before importing YouTube history", async () => {
  const { sync, calls } = setup();
  await sync.startup();
  assert.deepEqual(calls, ["ready", "settings", "youtube"]);
});

test("startup respects disabled YouTube history sync", async () => {
  const { sync, calls } = setup({
    storage: { get: async () => ({ idCondition_Youhist: false }) },
  });
  await sync.startup();
  assert.deepEqual(calls, ["ready"]);
});

test("startup catches initialization failures", async () => {
  const { sync, calls } = setup({
    ready: async () => {
      throw new Error("Database unavailable");
    },
  });
  await sync.startup();
  assert.deepEqual(calls, ["error"]);
});

test("periodic YouTube sync still runs when browser history fails", async () => {
  const { sync, calls } = setup({
    storage: {
      get: async () => ({
        idCondition_Youhist: true,
        idCondition_Browhist: true,
      }),
    },
  });
  await sync.periodic();
  assert.deepEqual(calls, ["ready", "error", "youtube"]);
});

test("startup imports browser history when enabled, even if YouTube sync is disabled", async () => {
  let request;
  const { sync, calls } = setup({
    storage: {
      get: async () => ({
        idCondition_Browhist: true,
        idCondition_Youhist: false,
      }),
    },
    history: {
      synchronize: async (...args) => {
        request = args;
      },
    },
  });
  await sync.startup();
  assert.equal(request[0], 0);
  assert.equal(request[1], true);
  assert.deepEqual(calls, ["ready"]);
});

test("browser history failure at startup does not block YouTube history", async () => {
  const { sync, calls } = setup({
    storage: {
      get: async () => ({
        idCondition_Browhist: true,
        idCondition_Youhist: true,
      }),
    },
  });
  await sync.startup();
  assert.deepEqual(calls, ["ready", "error", "youtube"]);
});

test("measured playbacks are recovered before imports look for gaps", async () => {
  const { sync, calls } = setup({
    storage: {
      get: async () => ({
        idCondition_Youprog: true,
        idCondition_Youhist: true,
      }),
    },
    recoverPlaybacks: async () => {
      calls.push("recover");
    },
  });
  await sync.periodic();
  assert.deepEqual(calls, ["ready", "recover", "youtube"]);
});

test("disabled progress tracking recovers nothing and failures keep imports running", async () => {
  const disabled = setup({
    recoverPlaybacks: async () => {
      disabled.calls.push("recover");
    },
  });
  await disabled.sync.periodic();
  assert.ok(!disabled.calls.includes("recover"));
  const failing = setup({
    storage: {
      get: async () => ({
        idCondition_Youprog: true,
        idCondition_Youhist: true,
      }),
    },
    recoverPlaybacks: async () => {
      throw new Error("Recovery unavailable");
    },
  });
  await failing.sync.periodic();
  assert.deepEqual(failing.calls, ["ready", "error", "youtube"]);
});

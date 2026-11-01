import assert from "node:assert/strict";
import test from "node:test";
import { AlarmManager } from "./alarm-manager.js";

function setup(t, existing) {
  const previous = globalThis.chrome;
  const created = [];
  globalThis.chrome = {
    storage: { sync: { get: async () => ({ sync_interval_minutes: 60 }) } },
    alarms: {
      get: async () => existing || { periodInMinutes: 60 },
      create: async (...args) => {
        created.push(args);
      },
    },
  };
  t.after(() => {
    globalThis.chrome = previous;
  });
  return { manager: new AlarmManager(), created };
}

test("worker initialization preserves the next scheduled synchronization", async (t) => {
  const { manager, created } = setup(t, {
    periodInMinutes: 60,
    scheduledTime: 123,
  });
  await manager.setupSynchronizationAlarm();
  assert.deepEqual(created, []);
});

test("changed interval replaces the existing alarm", async (t) => {
  const { manager, created } = setup(t, { periodInMinutes: 30 });
  await manager.setupSynchronizationAlarm();
  assert.deepEqual(created, [["synchronize", { periodInMinutes: 60 }]]);
});

test("a missing synchronization alarm is recreated", async (t) => {
  const { manager, created } = setup(t, {});
  await manager.setupSynchronizationAlarm();
  assert.equal(created.length, 1);
});

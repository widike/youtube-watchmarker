import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseManager } from "./bg-database.js";
import { HISTORY_SYNC_ALARM } from "./bg-sync-manager.js";

test("database initialization schedules cloud retries and preserves them across worker restarts", async () => {
  const alarms = new Map();
  let created = 0;
  globalThis.chrome = {
    alarms: {
      get: async (name) => alarms.get(name),
      create: async (name, options) => {
        created++;
        alarms.set(name, { name, ...options, scheduledTime: 12345 });
      },
    },
  };
  const initialize = async () => {
    const manager = new DatabaseManager();
    manager.openDatabaseAsync = async () => {};
    manager.notifyProvidersReady = () => {};
    await manager.init();
  };
  await initialize();
  assert.equal(alarms.get(HISTORY_SYNC_ALARM).periodInMinutes, 0.5);
  await initialize();
  assert.equal(created, 1);
  assert.equal(alarms.get(HISTORY_SYNC_ALARM).scheduledTime, 12345);
  alarms.clear();
  await initialize();
  assert.equal(created, 2);
});

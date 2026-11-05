import { DatabaseProviderFactory } from "../../extension/providers/database-provider-factory.js";
import { credentialStorage } from "../../extension/providers/credential-storage.js";
import { supabaseDatabaseProvider } from "../../extension/providers/supabase-database-provider.js";
import { getBlockedVideoStore } from "../../extension/background/blocked-videos.js";
import {
  saveVideos,
  pendingVideos,
} from "../../extension/history/history-storage.js";

export async function testCloudTraffic({ test, database, remote, assert }) {
  await test("factory traffic stays bounded across idle worker restarts, local changes and failed requests", async () => {
    const db = await database();
    const cloud = remote();
    const owner = (await cloud.getSyncState()).owner;
    const blockStore = getBlockedVideoStore();
    const originalStorage = blockStore.storage;
    const originalNow = Date.now;
    const saved = new Map();
    const replace = (object, key, value) => {
      saved.set(key, { object, value: object[key] });
      object[key] = value;
    };
    let clock = originalNow();
    let checks = 0;
    let pages = 0;
    let uploads = 0;
    let offline = false;
    const local = {};
    blockStore.storage = {
      get: async () => structuredClone(local),
      set: async (updates) => Object.assign(local, structuredClone(updates)),
    };
    Date.now = () => clock;
    replace(credentialStorage, "getConfiguration", async () => ({
      projectId: "fixture",
    }));
    replace(credentialStorage, "getSession", async () => ({
      userId: owner,
      historyOwnerId: owner,
    }));
    replace(supabaseDatabaseProvider, "isConnected", false);
    replace(supabaseDatabaseProvider, "init", async () => {
      throw new Error("Repeated schema probes");
    });
    replace(supabaseDatabaseProvider, "getSyncState", async () => {
      checks++;
      if (offline) throw new Error("Quota exceeded");
      return cloud.getSyncState();
    });
    for (const method of [
      "getVideoPage",
      "getWatchTimePage",
      "getDurationPage",
    ])
      replace(supabaseDatabaseProvider, method, (...args) => {
        pages++;
        return cloud[method](...args);
      });
    for (const method of ["importVideos", "importWatchTime", "importDurations"])
      replace(supabaseDatabaseProvider, method, (rows) => {
        uploads += rows.length;
        return cloud[method](rows);
      });
    const worker = () => {
      const factory = new DatabaseProviderFactory();
      factory.setDatabaseManager({ database: db });
      return factory;
    };
    try {
      assert(
        (await worker().performDeltaSync()).success,
        "Initial sync failed",
      );
      const initialChecks = checks;
      clock += 30_000;
      assert(
        (await worker().performDeltaSync()).success,
        "Idle restart failed",
      );
      assert(
        checks === initialChecks,
        "Worker restart bypassed persisted polling interval",
      );
      // Twenty-four hours without new changes: 288 small checks, no row reads
      // or recurring repair writes, despite a fresh worker on every invocation.
      for (let tick = 0; tick < 288; tick++) {
        clock += 300_000;
        assert((await worker().performDeltaSync()).success, "Idle poll failed");
      }
      assert(
        checks === initialChecks + 288 && pages === 0 && uploads === 0,
        "Idle traffic included data scans or daily reuploads",
      );
      await saveVideos(db, [
        {
          strIdent: "abcdefghijk",
          intTimestamp: 1,
          strTitle: "Old watch",
          intCount: 1,
        },
      ]);
      clock += 30_000;
      const changed = await worker().performDeltaSync();
      assert(
        changed.success && uploads === 1 && changed.downloaded === 1,
        "Pending change did not bypass idle interval or downloaded unchanged records",
      );
      offline = true;
      await saveVideos(db, [
        { strIdent: "bbbbbbbbbbb", intTimestamp: 2, intCount: 1 },
      ]);
      const failed = await worker().performDeltaSync();
      assert(
        !failed.success && failed.retryAt === clock + 60_000,
        "Failure backoff was not saved",
      );
      const failedChecks = checks;
      clock += 30_000;
      await worker().performDeltaSync();
      assert(
        checks === failedChecks && (await pendingVideos(db)).length === 1,
        "Restart or pending outbox bypassed failure backoff",
      );
      clock += 30_000;
      offline = false;
      const retried = await worker().performDeltaSync();
      assert(retried.success, `Retry did not recover: ${retried.error}`);
      assert(
        !(await pendingVideos(db)).length,
        "Retry discarded or retained acknowledged upload",
      );
    } finally {
      Date.now = originalNow;
      blockStore.storage = originalStorage;
      for (const [key, entry] of saved) entry.object[key] = entry.value;
      db.close();
    }
  });
}

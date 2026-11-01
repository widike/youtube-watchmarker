import { testWatchTimeSync } from "./watch-time-sync.browser.js";
import { DATABASE } from "../constants.js";
import {
  acknowledgeVideos,
  OUTBOX_STORE,
  META_STORE,
  pendingVideos,
  readMetadata,
  saveVideos,
  localPage,
  transactionDone,
  upgradeHistoryStorage,
  writeMetadata,
} from "../history-storage.js";
import { IndexedDBProvider } from "../indexeddb-provider.js";
import { deleteVideo } from "../history-storage.js";
import { HistorySync } from "../provider-sync.js";
import { mergeVideoData, isDeleted } from "../history-records.js";
import { DatabaseProviderFactory } from "../database-provider-factory.js";
import { recordPlayback } from "../history-playback.js";
import { testPlaybackDurability } from "./playback-durability.browser.js";
import { testWatchEvents } from "./watch-events.browser.js";
import { testHistoryReconciliation } from "./history-reconciliation.browser.js";

const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const video = (strIdent, intTimestamp = 100, intCount = 1) => ({
  strIdent,
  intTimestamp,
  intCount,
  strTitle: strIdent,
});
const open = (name, version, upgrade) =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () =>
      upgrade(request.result, request.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function database() {
  return open(crypto.randomUUID(), 2, (db, tx) => {
    db.createObjectStore(DATABASE.STORE_NAME, { keyPath: "strIdent" });
    upgradeHistoryStorage(db, tx);
  });
}
const test = async (name, run) => {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
  }
};
function remote() {
  const records = new Map();
  const times = new Map();
  return {
    times,
    importWatchTime: async (rows) => {
      for (const row of rows)
        if ((times.get(row.snapshotId)?.milliseconds || 0) < row.milliseconds)
          times.set(row.snapshotId, row);
      return true;
    },
    getWatchTimePage: async (after) =>
      [...times.values()]
        .filter((row) => row.snapshotId > after)
        .sort((a, b) => (a.snapshotId < b.snapshotId ? -1 : 1))
        .slice(0, 2),
    isConnected: true,
    records,
    importVideos: async (rows) => {
      for (const row of rows)
        records.set(
          row.strIdent,
          mergeVideoData([records.get(row.strIdent)].filter(Boolean), [row])[0],
        );
      return true;
    },
    getVideoPage: async (after) =>
      [...records.values()]
        .filter((row) => row.strIdent > after)
        .sort((a, b) => a.strIdent.localeCompare(b.strIdent))
        .slice(0, 2),
  };
}

await test("upgrade preserves records and seeds pending uploads atomically", async () => {
  const name = crypto.randomUUID();
  let db = await open(name, 1, (db) =>
    db.createObjectStore(DATABASE.STORE_NAME, { keyPath: "strIdent" }),
  );
  const tx = db.transaction(DATABASE.STORE_NAME, "readwrite");
  const done = transactionDone(tx);
  tx.objectStore(DATABASE.STORE_NAME).put(video("abcdefghijk"));
  await done;
  db.close();
  db = await open(name, 2, upgradeHistoryStorage);
  assert((await localPage(db)).length === 1, "migration lost history");
  assert((await pendingVideos(db)).length === 1, "migration missed upload");
});

await test("write waits for commit and aborted transaction keeps neither history nor outbox", async () => {
  const db = await database();
  await saveVideos(db, [video("abcdefghijk")]);
  assert(
    (await pendingVideos(db)).length === 1,
    "offline write was not queued",
  );
  try {
    await saveVideos(db, [video("lmnopqrstuv"), { strIdent: "" }]);
    assert(false, "invalid batch succeeded");
  } catch (error) {
    assert(error.message !== "invalid batch succeeded", error.message);
  }
  assert((await localPage(db)).length === 1, "partial aborted batch committed");
  assert((await pendingVideos(db)).length === 1, "aborted outbox committed");
});

await test("in-flight acknowledgement cannot discard a newer watch", async () => {
  const db = await database();
  await saveVideos(db, [video("abcdefghijk")]);
  const sent = await pendingVideos(db);
  await saveVideos(db, [video("abcdefghijk", 200, 3)]);
  await acknowledgeVideos(db, sent);
  assert(
    (await pendingVideos(db))[0].video.intCount === 3,
    "new watch discarded",
  );
  await acknowledgeVideos(db, await pendingVideos(db));
  assert((await pendingVideos(db)).length === 0, "ack not applied");
});

await test("two MacBooks and TV converge; fresh machine restores every cloud record", async () => {
  const cloud = remote();
  const devices = await Promise.all([database(), database(), database()]);
  await saveVideos(devices[0], [
    video("abcdefghijk", 10),
    video("bbbbbbbbbbb", 0),
  ]);
  await saveVideos(devices[1], [
    video("lmnopqrstuv", 20),
    video("abcdefghijk", 2, 4),
  ]);
  await saveVideos(devices[2], [video("zzzzzzzzzzz", 30)]);
  for (const db of devices)
    assert(
      (await new HistorySync(db, cloud).sync()).success,
      "initial sync failed",
    );
  for (const db of devices) {
    await new HistorySync(db, cloud).sync();
    const rows = await localPage(db);
    assert(rows.length === 4, "device missing shared history");
    assert(
      rows.find((row) => row.strIdent === "abcdefghijk").intCount === 4,
      "watch count regressed",
    );
  }
  const restored = await database();
  assert(
    (await new HistorySync(restored, cloud).sync()).success,
    "restore failed",
  );
  assert(
    (await localPage(restored)).length === 4,
    "fresh device did not restore all pages",
  );
});

await test("old imports and failures survive restart and retry without a discard limit", async () => {
  let db = await database();
  const name = db.name;
  await saveVideos(db, [video("abcdefghijk", 1)]);
  const cloud = remote();
  const upload = cloud.importVideos;
  cloud.importVideos = async () => {
    throw new Error("offline");
  };
  for (let attempt = 0; attempt < 7; attempt++) {
    assert(
      !(await new HistorySync(db, cloud).sync()).success,
      "offline sync reported success",
    );
  }
  db.close();
  db = await open(name, 2, () => {});
  cloud.importVideos = upload;
  assert(
    (await new HistorySync(db, cloud).sync()).success,
    "restart retry failed",
  );
  assert(cloud.records.has("abcdefghijk"), "old video never uploaded");
  assert((await pendingVideos(db)).length === 0, "upload was not acknowledged");
});

await test("daily reconciliation repairs partial cloud loss", async () => {
  const db = await database();
  const cloud = remote();
  await saveVideos(db, [video("abcdefghijk"), video("lmnopqrstuv")]);
  await new HistorySync(db, cloud).sync();
  cloud.records.delete("abcdefghijk");
  await writeMetadata(db, "repair", { completedAt: 0, after: "" });
  await new HistorySync(db, cloud).sync();
  assert(cloud.records.size === 2, "partial cloud loss was not repaired");
});

await test("failed page does not advance durable download cursor", async () => {
  const db = await database();
  const cloud = remote();
  await cloud.importVideos([
    video("abcdefghijk"),
    video("bbbbbbbbbbb"),
    video("zzzzzzzzzzz"),
  ]);
  const page = cloud.getVideoPage;
  cloud.getVideoPage = async (after) => {
    if (after) throw new Error("download interrupted");
    return page(after);
  };
  assert(
    !(await new HistorySync(db, cloud).sync()).success,
    "partial download reported complete",
  );
  assert(
    (await readMetadata(db, "downloadAfter")) === "bbbbbbbbbbb",
    "wrong persisted cursor",
  );
  cloud.getVideoPage = page;
  await new HistorySync(db, cloud).sync();
  assert((await localPage(db)).length === 3, "download did not resume");
});

await test("migration recovers the old queue before removing it; account changes are rejected", async () => {
  const db = await database();
  const values = {
    sync_queue_pending: [{ type: "PUT_VIDEO", data: video("abcdefghijk") }],
  };
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...values }),
        remove: async (keys) => keys.forEach((key) => delete values[key]),
      },
    },
  };
  const factory = new DatabaseProviderFactory();
  factory.setDatabaseManager({
    database: db,
    isInitialized: true,
    STORE_NAME: DATABASE.STORE_NAME,
  });
  await factory.init();
  assert(
    (await pendingVideos(db)).length === 1 && !values.sync_queue_pending,
    "old queue was not safely migrated",
  );
  await writeMetadata(db, "cloudIdentity", "project:user");
  try {
    await factory.assertIdentity({ projectId: "other" }, { userId: "user" });
    assert(false, "account switch allowed");
  } catch (error) {
    assert(error.message.includes("different connection"), error.message);
  }
  assert(
    db.objectStoreNames.contains(OUTBOX_STORE) &&
      db.objectStoreNames.contains(META_STORE),
    "stores missing",
  );
});

await test("explicit deletion syncs, stale offline writes cannot restore it, a new watch can", async () => {
  const cloud = remote();
  const mac1 = await database();
  const mac2 = await database();
  await saveVideos(mac1, [video("abcdefghijk", 100)]);
  await new HistorySync(mac1, cloud).sync();
  await new HistorySync(mac2, cloud).sync();
  await deleteVideo(mac1, "abcdefghijk");
  await new HistorySync(mac1, cloud).sync();
  // MacBook 2 was offline during deletion, with a clock far in the future.
  await saveVideos(mac2, [video("abcdefghijk", Date.now() + 1_000_000)]);
  await new HistorySync(mac2, cloud).sync();
  assert(
    isDeleted((await localPage(mac2))[0]),
    "stale watch restored a deleted video",
  );
  const restored = await database();
  await new HistorySync(restored, cloud).sync();
  const provider = new IndexedDBProvider({
    database: restored,
    isInitialized: true,
    STORE_NAME: DATABASE.STORE_NAME,
  });
  await provider.init();
  assert(
    (await provider.getVideo("abcdefghijk")) === null,
    "deleted video returned by lookup",
  );
  assert(
    (await provider.getAllVideos()).length === 0,
    "deleted video visible in history",
  );
  const tombstone = (await localPage(mac2))[0];
  await recordPlayback(mac2, "abcdefghijk", "Title", "later-explicit-watch");
  await new HistorySync(mac2, cloud).sync();
  await saveVideos(mac2, [tombstone], { pending: false });
  assert(
    !isDeleted((await localPage(mac2))[0]),
    "replayed deletion undid a new explicit watch",
  );
  await new HistorySync(mac1, cloud).sync();
  assert(
    !isDeleted((await localPage(mac1))[0]),
    "new explicit watch did not sync",
  );
});

await test("background downloads poll every five minutes and manual sync restores immediately", async () => {
  const db = await database();
  const cloud = remote();
  let clock = Date.now();
  const sync = new HistorySync(db, cloud, () => clock);
  await sync.sync({ forceDownload: false });
  await cloud.importVideos([video("abcdefghijk")]);
  await sync.sync({ forceDownload: false });
  assert((await localPage(db)).length === 0, "poll interval was ignored");
  clock += 6 * 60_000;
  await sync.sync({ forceDownload: false });
  assert((await localPage(db)).length === 1, "background pull did not run");
  await cloud.importVideos([video("lmnopqrstuv")]);
  await sync.sync();
  assert(
    (await localPage(db)).length === 2,
    "manual pull did not run immediately",
  );
  clock -= 86_400_000;
  await cloud.importVideos([video("zzzzzzzzzzz")]);
  await sync.sync({ forceDownload: false });
  assert(
    (await localPage(db)).length === 3,
    "clock rollback stopped cloud downloads",
  );
});

await test("history cards expose an accessible explicit trash action", async () => {
  const { videoCard } = await import("../ui/history-library.js");
  const container = document.createElement("div");
  container.innerHTML = videoCard(video("abcdefghijk"), false, true, 0, 1);
  const button = container.querySelector("[data-video-delete]");
  assert(
    button?.getAttribute("aria-label").includes("Delete"),
    "trash is inaccessible",
  );
  assert(
    button.dataset.videoDelete === "abcdefghijk",
    "trash targets wrong video",
  );
});

await testPlaybackDurability({ test, database, open, assert });
await testWatchEvents({ test, database, open, remote, assert });
await testHistoryReconciliation({ test, database, open, remote, assert });
await testWatchTimeSync({ test, database, remote, open, assert });
await fetch("/results", { method: "POST", body: JSON.stringify(results) });
document.body.textContent = JSON.stringify(results);

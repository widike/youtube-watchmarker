import { META_STORE, readRequest, transactionDone } from "./history-storage.js";
import {
  mergeWatchTime,
  normalizeWatchTime,
  TIME_PREFIX,
  TIME_OUTBOX,
} from "./watch-time-records.js";

const range = (prefix) => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

export async function mergeWatchTimes(db, rows, { pending = false } = {}) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  let abortReason;
  const done = transactionDone(tx, () => abortReason);
  try {
    putWatchTimes(tx, rows, {
      pending,
      fail: (error) => {
        abortReason = error;
      },
    });
  } catch (error) {
    abortReason = error;
    tx.abort();
  }
  await done;
}

export function putWatchTimes(tx, rows, { pending, fail }) {
  const store = tx.objectStore(META_STORE);
  for (const row of rows.map((row) => normalizeWatchTime(row))) {
    const key = `${TIME_PREFIX}${row.snapshotId}`;
    const read = store.get(key);
    read.onsuccess = () => {
      try {
        const next = mergeWatchTime(read.result, row);
        if (read.result && next.milliseconds === read.result.milliseconds)
          return;
        store.put(next, key);
        if (pending)
          store.put(
            { revision: crypto.randomUUID(), row: next },
            `${TIME_OUTBOX}${row.snapshotId}`,
          );
      } catch (error) {
        fail(error);
        tx.abort();
      }
    };
  }
}

async function readWatchTimes(source, range, limit) {
  const [keys, rows] = await Promise.all([
    readRequest(source.getAllKeys(range, limit)),
    readRequest(source.getAll(range, limit)),
  ]);
  return rows.map((row, index) =>
    normalizeWatchTime(row, keys[index].slice(TIME_PREFIX.length)),
  );
}

export function watchTimePage(db, after = "", limit = 500) {
  const store = db.transaction(META_STORE, "readonly").objectStore(META_STORE);
  const keys = IDBKeyRange.bound(
    `${TIME_PREFIX}${after}`,
    `${TIME_PREFIX}\uffff`,
    Boolean(after),
  );
  return readWatchTimes(store, keys, limit === Infinity ? undefined : limit);
}

export async function watchTimeForVideos(db, videoIds) {
  const index = db
    .transaction(META_STORE, "readonly")
    .objectStore(META_STORE)
    .index("watchTimeVideo");
  return (
    await Promise.all(
      [...new Set(videoIds)].map((id) =>
        readWatchTimes(index, IDBKeyRange.bound([id, 0], [id, []])),
      ),
    )
  ).flat();
}

export async function pendingWatchTime(db, limit = 100) {
  const tx = db.transaction(META_STORE, "readonly");
  return readRequest(
    tx.objectStore(META_STORE).getAll(range(TIME_OUTBOX), limit),
  );
}

export async function pendingWatchTimeCount(db) {
  const tx = db.transaction(META_STORE, "readonly");
  return readRequest(tx.objectStore(META_STORE).count(range(TIME_OUTBOX)));
}

export async function queueWatchTime(db, rows) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  for (const { snapshotId } of rows) {
    const request = store.get(`${TIME_PREFIX}${snapshotId}`);
    request.onsuccess = () => {
      if (request.result)
        store.put(
          {
            row: normalizeWatchTime(request.result, snapshotId),
            revision: crypto.randomUUID(),
          },
          `${TIME_OUTBOX}${snapshotId}`,
        );
    };
  }
  await done;
}

export async function acknowledgeWatchTime(db, entries) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  for (const entry of entries) {
    const key = `${TIME_OUTBOX}${entry.row.snapshotId}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.revision === entry.revision) store.delete(key);
    };
  }
  await done;
}

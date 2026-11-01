import { META_STORE, readRequest, transactionDone } from "./history-storage.js";
import {
  mergeWatchTime,
  normalizeWatchTime,
  TIME_PREFIX,
  TIME_OUTBOX,
} from "./watch-time-records.js";

const range = (prefix) => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

export async function mergeWatchTimes(db, rows, { pending = false } = {}) {
  const normalized = rows.map((row) => normalizeWatchTime(row));
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  for (const row of normalized) {
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
      } catch {
        tx.abort();
      }
    };
  }
  await done;
}

export async function watchTimePage(db, after = "", limit = 500) {
  const tx = db.transaction(META_STORE, "readonly");
  const done = transactionDone(tx);
  const rows = [];
  const request = tx
    .objectStore(META_STORE)
    .openCursor(
      IDBKeyRange.bound(
        `${TIME_PREFIX}${after}`,
        `${TIME_PREFIX}\uffff`,
        Boolean(after),
      ),
    );
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor || rows.length >= limit) return;
    rows.push(
      normalizeWatchTime(cursor.value, cursor.key.slice(TIME_PREFIX.length)),
    );
    cursor.continue();
  };
  await done;
  return rows;
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
  for (const row of rows)
    tx.objectStore(META_STORE).put(
      { row, revision: crypto.randomUUID() },
      `${TIME_OUTBOX}${row.snapshotId}`,
    );
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

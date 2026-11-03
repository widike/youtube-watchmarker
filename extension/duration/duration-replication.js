import {
  META_STORE,
  readRequest,
  transactionDone,
} from "../history/history-storage.js";
import {
  DURATION_PREFIX,
  DURATION_OUTBOX,
  durationRange,
  normalizeDuration,
  newerDuration,
} from "./duration-records.js";

export async function mergeDurations(db, rows, { pending = false } = {}) {
  const normalized = rows.map(normalizeDuration);
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  let changed = 0;
  for (const incoming of normalized) {
    const key = `${DURATION_PREFIX}${incoming.strIdent}`;
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const next = newerDuration(request.result, incoming);
        if (JSON.stringify(next) === JSON.stringify(request.result)) return;
        store.put(next, key);
        changed++;
        if (pending)
          store.put(
            { row: next, revision: crypto.randomUUID() },
            `${DURATION_OUTBOX}${next.strIdent}`,
          );
      } catch {
        tx.abort();
      }
    };
  }
  await done;
  return changed;
}

export async function durationPage(db, after = "", limit = 500) {
  const tx = db.transaction(META_STORE, "readonly");
  return readRequest(
    tx
      .objectStore(META_STORE)
      .getAll(
        IDBKeyRange.bound(
          `${DURATION_PREFIX}${after}`,
          `${DURATION_PREFIX}\uffff`,
          Boolean(after),
        ),
        limit,
      ),
  );
}

export async function pendingDurations(db, limit = 100) {
  const tx = db.transaction(META_STORE, "readonly");
  return readRequest(
    tx.objectStore(META_STORE).getAll(durationRange(DURATION_OUTBOX), limit),
  );
}

export async function pendingDurationCount(db) {
  const tx = db.transaction(META_STORE, "readonly");
  return readRequest(
    tx.objectStore(META_STORE).count(durationRange(DURATION_OUTBOX)),
  );
}

export async function queueDurations(db, rows) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  for (const row of rows) {
    const request = store.get(`${DURATION_PREFIX}${row.strIdent}`);
    request.onsuccess = () => {
      // Re-read in this transaction: a fetch or cache removal may have raced repair.
      try {
        if (request.result)
          store.put(
            {
              row: normalizeDuration(request.result),
              revision: crypto.randomUUID(),
            },
            `${DURATION_OUTBOX}${row.strIdent}`,
          );
      } catch {
        tx.abort();
      }
    };
  }
  await done;
}

export async function acknowledgeDurations(db, entries) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  for (const entry of entries) {
    const key = `${DURATION_OUTBOX}${entry.row.strIdent}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.revision === entry.revision) store.delete(key);
    };
  }
  await done;
}

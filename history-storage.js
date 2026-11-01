import { DATABASE } from "./constants.js";
import {
  mergeVideo,
  mergeVideoData,
  normalizeVideo,
} from "./history-records.js";
import { mergeSourceVideo } from "./history-source.js";
import {
  EVENT_STORE,
  videoEvents,
  putEventVideo,
  readVideos,
} from "./history-event-storage.js";

export const OUTBOX_STORE = "historyOutbox";
export const META_STORE = "historyMetadata";

// Runs inside the versionchange transaction: old records and their pending
// uploads become durable together. Never delete or recreate the history store.
export function upgradeHistoryStorage(db, transaction) {
  if (!db.objectStoreNames.contains(META_STORE))
    db.createObjectStore(META_STORE);
  const outbox = db.objectStoreNames.contains(OUTBOX_STORE)
    ? transaction.objectStore(OUTBOX_STORE)
    : db.createObjectStore(OUTBOX_STORE, { keyPath: "strIdent" });
  if (db.objectStoreNames.contains(EVENT_STORE)) return;
  const events = db.createObjectStore(EVENT_STORE, {
    keyPath: ["strIdent", "eventId"],
  });
  events.createIndex("strIdent", "strIdent");
  events.createIndex("watchedAt", "watchedAt");
  const request = transaction.objectStore(DATABASE.STORE_NAME).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const video = normalizeVideo(cursor.value);
    // Old receipts have no dates left. Keep retry identities without inventing
    // timestamps or adding them to the historical count.
    const receiptRequest = transaction
      .objectStore(META_STORE)
      .get(`playbacks:${cursor.key}`);
    receiptRequest.onsuccess = () => {
      for (const id of receiptRequest.result || [])
        video.watchEvents.push({
          eventId: `playback:${id}`,
          watchedAt: 0,
          source: "receipt",
          precision: "exact",
          observedDeletion: 0,
        });
      putEventVideo(transaction, video);
      outbox.put({
        strIdent: cursor.key,
        revision: crypto.randomUUID(),
        video,
      });
      transaction.objectStore(META_STORE).delete(`playbacks:${cursor.key}`);
    };
    cursor.continue();
  };
}

export function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onabort = () =>
      reject(transaction.error || new Error("History transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error || new Error("History transaction failed"));
  });
}

export function readRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// A watch and its upload obligation are committed in the SAME transaction,
// even before cloud setup or during network/auth failures.
export async function saveVideos(
  db,
  videos,
  { pending = true, source = false } = {},
) {
  const incomingVideos = mergeVideoData(videos);
  const tx = db.transaction(
    [DATABASE.STORE_NAME, OUTBOX_STORE, EVENT_STORE],
    "readwrite",
    {
      durability: "strict",
    },
  );
  const done = transactionDone(tx);
  const history = tx.objectStore(DATABASE.STORE_NAME);
  const outbox = tx.objectStore(OUTBOX_STORE);
  for (const incoming of incomingVideos) {
    const request = history.get(incoming.strIdent);
    request.onsuccess = () => {
      try {
        videoEvents(tx, incoming.strIdent, (watchEvents) => {
          try {
            const previous = request.result
              ? { ...request.result, watchEvents }
              : null;
            const video = (source ? mergeSourceVideo : mergeVideo)(
              previous,
              incoming,
            );
            // Recheck source overlap inside the write transaction: playback
            // may have arrived since the importer's earlier lookup.
            if (
              source &&
              previous &&
              JSON.stringify(normalizeVideo(previous)) === JSON.stringify(video)
            )
              return;
            putEventVideo(tx, video);
            if (pending)
              outbox.put({
                strIdent: video.strIdent,
                revision: crypto.randomUUID(),
                video,
              });
          } catch {
            tx.abort();
          }
        });
      } catch (_error) {
        tx.abort();
      }
    };
  }
  return done;
}

export async function pendingVideos(db, limit = 100) {
  const tx = db.transaction(OUTBOX_STORE, "readonly");
  return readRequest(tx.objectStore(OUTBOX_STORE).getAll(undefined, limit));
}

export async function acknowledgeVideos(db, sent) {
  const tx = db.transaction(OUTBOX_STORE, "readwrite", {
    durability: "strict",
  });
  const done = transactionDone(tx);
  const outbox = tx.objectStore(OUTBOX_STORE);
  for (const entry of sent) {
    const request = outbox.get(entry.strIdent);
    request.onsuccess = () => {
      // A newer watch may have arrived while the HTTP request was running.
      if (request.result?.revision === entry.revision)
        outbox.delete(entry.strIdent);
    };
  }
  return done;
}

export async function readMetadata(db, key) {
  const tx = db.transaction(META_STORE, "readonly");
  return readRequest(tx.objectStore(META_STORE).get(key));
}

export async function writeMetadata(db, key, value) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  tx.objectStore(META_STORE).put(value, key);
  return done;
}

export async function localPage(db, after = "", limit = 500) {
  return readVideos(db, { after, limit });
}

// Only an explicit user action creates a deletion marker. Sync never calls this.
export async function deleteVideo(db, strIdent) {
  const tx = db.transaction(
    [DATABASE.STORE_NAME, OUTBOX_STORE, EVENT_STORE],
    "readwrite",
    {
      durability: "strict",
    },
  );
  const done = transactionDone(tx);
  const history = tx.objectStore(DATABASE.STORE_NAME);
  const request = history.get(strIdent);
  request.onsuccess = () => {
    const previous = request.result || {
      strIdent,
      intTimestamp: 0,
      strTitle: "",
      intCount: 1,
    };
    const video = {
      ...previous,
      intDeletedAt:
        Math.max(
          Date.now(),
          previous.intTimestamp || 0,
          previous.intDeletedAt || 0,
        ) + 1,
    };
    history.put(video);
    videoEvents(tx, strIdent, (watchEvents) => {
      tx.objectStore(OUTBOX_STORE).put({
        strIdent,
        revision: crypto.randomUUID(),
        video: { ...video, watchEvents },
      });
    });
  };
  return done;
}

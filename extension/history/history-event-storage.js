import { DATABASE } from "../shared/constants.js";

export const EVENT_STORE = "watchEvents";

const revisions = new WeakMap();
const trackedTransactions = new WeakSet();

export function historyRevision(db) {
  return revisions.get(db) ?? 0;
}

export function markHistoryChanged(transaction) {
  trackedTransactions.add(transaction);
}

export function commitHistoryRevision(transaction) {
  if (trackedTransactions.has(transaction))
    revisions.set(transaction.db, historyRevision(transaction.db) + 1);
}

export async function knownPlaybackEvents(db, plays) {
  const tx = db.transaction(EVENT_STORE, "readonly");
  const store = tx.objectStore(EVENT_STORE);
  const requests = plays.map(
    ({ videoId, playbackId }) =>
      new Promise((resolve, reject) => {
        const request = store.getKey([videoId, `playback:${playbackId}`]);
        request.onsuccess = () => resolve(Boolean(request.result));
        request.onerror = () => reject(request.error);
      }),
  );
  return Promise.all(requests);
}

export function videoEvents(transaction, strIdent, receive) {
  const request = transaction
    .objectStore(EVENT_STORE)
    .index("strIdent")
    .getAll(strIdent);
  request.onsuccess = () =>
    receive(request.result.map(({ strIdent: _id, ...event }) => event));
}

export function putEventVideo(transaction, video) {
  markHistoryChanged(transaction);
  const { watchEvents, ...summary } = video;
  transaction.objectStore(DATABASE.STORE_NAME).put(summary);
  const store = transaction.objectStore(EVENT_STORE);
  for (const event of watchEvents)
    store.put({ strIdent: video.strIdent, ...event });
}

// Read summary and events from the same transaction, including exports/repair.
export function readVideos(db, { id, after = "", limit } = {}) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DATABASE.STORE_NAME, EVENT_STORE], "readonly");
    const store = tx.objectStore(DATABASE.STORE_NAME);
    const range = after ? IDBKeyRange.lowerBound(after, true) : undefined;
    const request =
      id === undefined ? store.getAll(range, limit) : store.get(id);
    let videos = [];
    request.onsuccess = () => {
      const rows =
        id === undefined
          ? request.result
          : request.result
            ? [request.result]
            : [];
      videos = rows.map((row) => ({ ...row, watchEvents: [] }));
      if (!rows.length) return;
      const byId = new Map(videos.map((video) => [video.strIdent, video]));
      // Two bulk reads replace one request per video. Keep paged exports and
      // single-video lookups bounded to the summaries read in this transaction.
      const events = tx
        .objectStore(EVENT_STORE)
        .getAll(
          IDBKeyRange.bound([rows[0].strIdent], [rows.at(-1).strIdent, []]),
        );
      events.onsuccess = () => {
        for (const { strIdent, ...event } of events.result)
          byId.get(strIdent)?.watchEvents.push(event);
      };
    };
    tx.oncomplete = () => {
      resolve(id === undefined ? videos : videos[0] || null);
    };
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not read watch events"));
  });
}

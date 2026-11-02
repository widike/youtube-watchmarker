import { DATABASE } from "../shared/constants.js";

export const EVENT_STORE = "watchEvents";

export function videoEvents(transaction, strIdent, receive) {
  const request = transaction
    .objectStore(EVENT_STORE)
    .index("strIdent")
    .getAll(strIdent);
  request.onsuccess = () =>
    receive(request.result.map(({ strIdent: _id, ...event }) => event));
}

export function putEventVideo(transaction, video) {
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
    const videos = [];
    request.onsuccess = () => {
      const rows =
        id === undefined
          ? request.result
          : request.result
            ? [request.result]
            : [];
      for (const row of rows)
        videoEvents(tx, row.strIdent, (watchEvents) =>
          videos.push({ ...row, watchEvents }),
        );
    };
    tx.oncomplete = () => {
      videos.sort((a, b) =>
        a.strIdent < b.strIdent ? -1 : a.strIdent > b.strIdent ? 1 : 0,
      );
      resolve(id === undefined ? videos : videos[0] || null);
    };
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Could not read watch events"));
  });
}

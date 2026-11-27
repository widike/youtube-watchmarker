import { DATABASE } from "../shared/constants.js";
import { isDeleted, normalizeVideo } from "./history-records.js";
import {
  EVENT_STORE,
  videoEvents,
  putEventVideo,
} from "./history-event-storage.js";
import {
  META_STORE,
  OUTBOX_STORE,
  readRequest,
  transactionDone,
} from "./history-storage.js";
import { dayKey } from "../statistics/statistics-dates.js";

// Recovery only fills a gap: it never revives deleted history, recounts a known
// play, or adds to a date-only import that already stands for that day's watch.
function canRecover(
  previous,
  watchEvents,
  eventId,
  watchedAt,
  observedDeletion,
) {
  return (
    watchedAt > (previous?.intDeletedAt || 0) &&
    observedDeletion === (previous?.intDeletedAt || 0) &&
    !watchEvents.some(
      (event) =>
        event.eventId === eventId ||
        (event.source === "saved" &&
          dayKey(event.watchedAt) === dayKey(watchedAt)),
    )
  );
}

// An immutable event, materialized summary and upload obligation commit together.
// Event identities never expire, so arbitrarily late retries remain safe.
export async function recordPlayback(
  db,
  videoId,
  title,
  playbackId,
  { watchedAt, recovered = false, observedDeletion = 0 } = {},
) {
  if (typeof playbackId !== "string" || !playbackId || playbackId.length > 1000)
    throw new Error("A playback ID is required");
  const tx = db.transaction(
    [DATABASE.STORE_NAME, OUTBOX_STORE, EVENT_STORE, META_STORE],
    "readwrite",
    { durability: "strict" },
  );
  const done = transactionDone(tx);
  const eventId = `playback:${playbackId}`;
  let first;
  if (watchedAt && !recovered) {
    const snapshot = tx
      .objectStore(META_STORE)
      .index("watchTimeEvent")
      .get([videoId, eventId]);
    try {
      first = await readRequest(snapshot);
    } catch {
      await done;
    }
  }
  let result = null;
  const request = tx.objectStore(DATABASE.STORE_NAME).get(videoId);
  request.onsuccess = () =>
    videoEvents(tx, videoId, (watchEvents) => {
      try {
        const previous = request.result
          ? normalizeVideo({ ...request.result, watchEvents })
          : null;
        const marker = previous?.intDeletedAt || 0;
        const existingEvent = watchEvents.find(
          (event) => event.eventId === eventId,
        );
        const alreadyCounted = Boolean(existingEvent);
        if (
          existingEvent &&
          (isDeleted(previous) || existingEvent.observedDeletion !== marker)
        )
          return;
        const date = first?.eventWatchedAt ?? watchedAt ?? Date.now();
        if (
          recovered &&
          !canRecover(previous, watchEvents, eventId, date, observedDeletion)
        )
          return;
        if (
          !alreadyCounted &&
          watchedAt &&
          (date <= marker || (first && first.observedDeletion !== marker))
        )
          return;
        const latestTimestamp = alreadyCounted
          ? previous.intTimestamp
          : Math.max(
              date,
              previous?.intTimestamp || 0,
              (previous?.intDeletedAt || 0) + 1,
            );
        const video = normalizeVideo({
          ...previous,
          strIdent: videoId,
          strTitle: title || previous?.strTitle || "",
          intTimestamp: latestTimestamp,
          intImportedCount: previous?.intImportedCount || 0,
          watchEvents: alreadyCounted
            ? watchEvents
            : [
                ...watchEvents,
                {
                  eventId,
                  watchedAt: date,
                  source: "playback",
                  precision: "exact",
                  observedDeletion: marker,
                },
              ],
        });
        if (JSON.stringify(previous) !== JSON.stringify(video)) {
          putEventVideo(tx, video);
          tx.objectStore(OUTBOX_STORE).put({
            strIdent: videoId,
            revision: crypto.randomUUID(),
            video,
          });
        }
        result = video;
      } catch {
        tx.abort();
      }
    });
  await done;
  return result;
}

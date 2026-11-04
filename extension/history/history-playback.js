import { DATABASE } from "../shared/constants.js";
import { isDeleted, normalizeVideo } from "./history-records.js";
import {
  EVENT_STORE,
  videoEvents,
  putEventVideo,
} from "./history-event-storage.js";
import { OUTBOX_STORE, transactionDone } from "./history-storage.js";
import { dayKey } from "../statistics/statistics-dates.js";

// Recovery only fills a gap: it never revives deleted history, recounts a known
// play, or adds to a date-only import that already stands for that day's watch.
function canRecover(previous, watchEvents, eventId, recoveredAt) {
  return (
    recoveredAt > (previous?.intDeletedAt || 0) &&
    !watchEvents.some(
      (event) =>
        event.eventId === eventId ||
        (event.source === "saved" &&
          dayKey(event.watchedAt) === dayKey(recoveredAt)),
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
  recoveredAt = 0,
) {
  if (typeof playbackId !== "string" || !playbackId || playbackId.length > 1000)
    throw new Error("A playback ID is required");
  const tx = db.transaction(
    [DATABASE.STORE_NAME, OUTBOX_STORE, EVENT_STORE],
    "readwrite",
    { durability: "strict" },
  );
  const done = transactionDone(tx);
  let result = null;
  const request = tx.objectStore(DATABASE.STORE_NAME).get(videoId);
  request.onsuccess = () =>
    videoEvents(tx, videoId, (watchEvents) => {
      try {
        const previous = request.result
          ? normalizeVideo({ ...request.result, watchEvents })
          : null;
        const eventId = `playback:${playbackId}`;
        const alreadyCounted = watchEvents.some(
          (event) => event.eventId === eventId,
        );
        if (alreadyCounted && (!previous || isDeleted(previous))) return;
        if (
          recoveredAt &&
          !canRecover(previous, watchEvents, eventId, recoveredAt)
        )
          return;
        const watchedAt = recoveredAt || Date.now();
        const latestTimestamp = alreadyCounted
          ? previous.intTimestamp
          : Math.max(
              watchedAt,
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
                  watchedAt,
                  source: "playback",
                  precision: "exact",
                  observedDeletion: previous?.intDeletedAt || 0,
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

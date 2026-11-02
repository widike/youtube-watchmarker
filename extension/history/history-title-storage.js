import { DATABASE } from "../shared/constants.js";
import { isDeleted } from "./history-records.js";
import { isValidVideoTitle } from "../shared/validation.js";
import { normalizeVideoTitle } from "../shared/text-utils.js";
import { EVENT_STORE, videoEvents } from "./history-event-storage.js";
import { OUTBOX_STORE, transactionDone } from "./history-storage.js";

// Recheck inside the transaction so recovery cannot overwrite a newer title,
// resurrect a deletion, or replace playback events that arrived during lookup.
export async function repairVideoTitle(db, videoId, title) {
  const normalized = normalizeVideoTitle(title);
  if (!isValidVideoTitle(normalized)) return "";
  const tx = db.transaction(
    [DATABASE.STORE_NAME, EVENT_STORE, OUTBOX_STORE],
    "readwrite",
    { durability: "strict" },
  );
  const done = transactionDone(tx);
  let result = "";
  const history = tx.objectStore(DATABASE.STORE_NAME);
  const request = history.get(videoId);
  request.onsuccess = () => {
    const previous = request.result;
    if (!previous || isDeleted(previous)) return;
    result = previous.strTitle;
    if (isValidVideoTitle(result)) return;
    const video = { ...previous, strTitle: normalized };
    history.put(video);
    videoEvents(tx, videoId, (watchEvents) => {
      tx.objectStore(OUTBOX_STORE).put({
        strIdent: videoId,
        revision: crypto.randomUUID(),
        video: { ...video, watchEvents },
      });
    });
    result = normalized;
  };
  await done;
  return result;
}

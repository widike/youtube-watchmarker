import { normalizeVideo, isDeleted } from "./history-records.js";
import { historyEntries } from "./history-events.js";
import { activityEntries } from "./history-activity.js";
import { IMPORT_CORRECTION } from "./history-import-corrections.js";

/** Persist the same conservative evidence rule used by statistics. */
export function reconcileImportedVideo(input, now = Date.now()) {
  const video = normalizeVideo(input);
  if (isDeleted(video)) return { video, removed: 0 };
  const kept = new Set(
    activityEntries([video], now).map((entry) => entry.entryId),
  );
  const redundant = historyEntries([video]).filter(
    (entry) =>
      entry.watchSource === "saved" &&
      entry.intTimestamp <= now &&
      !kept.has(entry.entryId),
  );
  const watchEvents = [...video.watchEvents];
  let removed = 0;
  for (const entry of redundant) {
    const targetId = entry.entryId.slice(video.strIdent.length + 1);
    const eventId = `${IMPORT_CORRECTION}${targetId}`;
    // Normal source IDs are short; preserve unusually long externally supplied
    // IDs rather than risk generating an invalid cloud event or losing data.
    if (eventId.length > 1024) continue;
    const original = video.watchEvents.find(
      (event) => event.eventId === targetId,
    );
    watchEvents.push({
      eventId,
      watchedAt: 0,
      source: "receipt",
      precision: "inferred",
      observedDeletion: original.observedDeletion,
    });
    removed++;
  }
  return {
    video: removed ? normalizeVideo({ ...video, watchEvents }) : video,
    removed,
  };
}

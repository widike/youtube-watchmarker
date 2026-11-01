import { countedEvents, mergeEvents, savedEvent } from "./history-events.js";

// One monotonic merge rule for imports, local writes and downloaded history.
export function normalizeVideo(video) {
  const strIdent = String(video.strIdent || "").trim();
  if (!strIdent) throw new Error("A video ID is required");
  const timestamp = Math.floor(Number(video.intTimestamp));
  const count = Number(video.intCount);
  const deleted = Number(video.intDeletedAt);
  const watchEvents = mergeEvents(
    video.watchEvents ?? savedEvent({ ...video, strIdent }),
  );
  const known = countedEvents(watchEvents);
  const savedCount = watchEvents.filter(
    (event) => event.source === "saved",
  ).length;
  const playbacks = known.filter((event) => event.source === "playback").length;
  const imported = Number(video.intImportedCount);
  const intImportedCount =
    Number.isSafeInteger(imported) && imported >= 0
      ? imported
      : Math.max(
          0,
          (Number.isSafeInteger(count) && count > 0 ? count : 1) - playbacks,
        );
  const intUnknownCount = Math.max(0, intImportedCount - savedCount);
  return {
    strIdent,
    intTimestamp:
      Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0,
    strTitle: String(video.strTitle || ""),
    intCount: Math.max(1, intUnknownCount + known.length),
    intUnknownCount,
    intImportedCount,
    watchEvents,
    intDeletedAt: Number.isSafeInteger(deleted) && deleted > 0 ? deleted : 0,
  };
}

export function mergeVideo(existing, incoming) {
  const next = normalizeVideo(incoming);
  if (!existing) return next;
  const previous = normalizeVideo(existing);
  const intDeletedAt = Math.max(previous.intDeletedAt, next.intDeletedAt);
  // A stale device has not seen a later deletion. Its imports and queued
  // writes cannot restore that record, even when its clock runs ahead.
  const observedDeletion = [previous, next].filter(
    (row) => row.intDeletedAt === intDeletedAt,
  );
  const titles = [previous, next].sort(
    (a, b) =>
      b.intTimestamp - a.intTimestamp ||
      (a.strTitle < b.strTitle ? 1 : a.strTitle > b.strTitle ? -1 : 0),
  );
  const watchEvents = mergeEvents(previous.watchEvents, next.watchEvents);
  return normalizeVideo({
    strIdent: next.strIdent,
    intTimestamp: Math.max(...observedDeletion.map((row) => row.intTimestamp)),
    intDeletedAt,
    strTitle: titles.find((row) => row.strTitle.trim())?.strTitle || "",
    intImportedCount: Math.max(
      previous.intImportedCount,
      next.intImportedCount,
    ),
    watchEvents,
  });
}

export function mergeVideoData(...sources) {
  const records = new Map();
  for (const video of sources.flat()) {
    records.set(video.strIdent, mergeVideo(records.get(video.strIdent), video));
  }
  return [...records.values()];
}

export function isDeleted(video) {
  return Boolean(
    video?.intDeletedAt && video.intTimestamp <= video.intDeletedAt,
  );
}

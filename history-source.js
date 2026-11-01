import { mergeVideo, normalizeVideo } from "./history-records.js";
import { dayKey } from "./statistics-dates.js";

/** Import observations only when this video/timestamp is not already saved. */
export function mergeSourceVideo(existing, source) {
  if (!existing) return normalizeVideo(source);
  const previous = normalizeVideo(existing);
  const incoming = normalizeVideo(source);
  // An undated like cannot establish an additional watch of a known video.
  if (!incoming.intTimestamp && !incoming.watchEvents.length) return previous;
  const known = previous.watchEvents.filter(
    (event) => event.source !== "receipt",
  );
  if (
    previous.intTimestamp > 0 &&
    !known.some((event) => event.watchedAt === previous.intTimestamp)
  )
    known.push({ watchedAt: previous.intTimestamp, precision: "inferred" });
  const watchEvents = incoming.watchEvents.filter((event) => {
    // Session identity remains authoritative for real playback events.
    if (event.source !== "saved") return true;
    return !known.some(
      (saved) =>
        saved.watchedAt === event.watchedAt ||
        ((saved.precision === "day" || event.precision === "day") &&
          dayKey(saved.watchedAt) === dayKey(event.watchedAt)),
    );
  });
  if (incoming.watchEvents.length && !watchEvents.length) return previous;
  return mergeVideo(previous, {
    ...incoming,
    watchEvents,
    intImportedCount: Math.max(
      0,
      incoming.intImportedCount -
        (incoming.watchEvents.length - watchEvents.length),
    ),
  });
}

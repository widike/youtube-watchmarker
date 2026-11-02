import { excludedImportIds } from "./history-import-corrections.js";

const positiveTime = (value) =>
  Number.isSafeInteger(Math.floor(Number(value))) && Number(value) > 0
    ? Math.floor(Number(value))
    : 0;

export function savedEvent(video) {
  const watchedAt = positiveTime(video.intTimestamp);
  if (!watchedAt) return [];
  return [
    {
      eventId: `saved:${video.strIdent}:${watchedAt}`,
      watchedAt,
      source: "saved",
      precision: "inferred",
      observedDeletion:
        watchedAt > positiveTime(video.intDeletedAt)
          ? positiveTime(video.intDeletedAt)
          : 0,
    },
  ];
}

// Event identity, rather than timestamp, deduplicates deliveries. Two actual
// playbacks in the same millisecond remain two watches.
export function mergeEvents(...sources) {
  const events = new Map();
  for (const event of sources.flat()) {
    if (
      !event ||
      typeof event.eventId !== "string" ||
      !event.eventId ||
      event.eventId.length > 1024
    )
      throw new Error("A stable watch event ID is required");
    const source = ["playback", "saved", "receipt"].includes(event.source)
      ? event.source
      : "saved";
    const watchedAt = positiveTime(event.watchedAt);
    if (!watchedAt && source !== "receipt")
      throw new Error("A watch timestamp is required");
    const next = {
      eventId: event.eventId,
      watchedAt,
      source,
      precision: ["day", "inferred"].includes(event.precision)
        ? event.precision
        : "exact",
      observedDeletion: positiveTime(event.observedDeletion),
    };
    const previous = events.get(next.eventId);
    if (previous && JSON.stringify(next) !== JSON.stringify(previous))
      throw new Error("Conflicting payload for an immutable watch event");
    events.set(next.eventId, next);
  }
  return [...events.values()].sort((a, b) =>
    a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0,
  );
}

export function countedEvents(events) {
  const excluded = excludedImportIds(events);
  return events.filter(
    (event) =>
      event.source !== "receipt" &&
      (event.source !== "saved" || !excluded.has(event.eventId)),
  );
}

// The timeline contains watch occurrences, plus an honest undated summary for
// counts whose timestamps were already overwritten by the previous database.
export function historyEntries(videos) {
  return videos.flatMap((video) => {
    const events = countedEvents(video.watchEvents || savedEvent(video))
      .filter(
        (event) =>
          (event.source === "playback" ||
            event.watchedAt > (video.intDeletedAt || 0)) &&
          (event.observedDeletion || 0) === (video.intDeletedAt || 0),
      )
      .sort(
        (a, b) =>
          a.watchedAt - b.watchedAt || a.eventId.localeCompare(b.eventId),
      );
    const entries = events.map((event, index) => ({
      ...video,
      watchEvents: undefined,
      entryId: `${video.strIdent}:${event.eventId}`,
      intTimestamp: event.watchedAt,
      watchSource: event.source,
      watchPrecision: event.precision,
      watchNumber: index + 1,
    }));
    const unknown =
      video.intUnknownCount ??
      Math.max(0, (video.intCount || 1) - events.length);
    if (unknown && !video.intDeletedAt)
      entries.push({
        ...video,
        watchEvents: undefined,
        entryId: `${video.strIdent}:undated`,
        intTimestamp: 0,
        unknownViews: unknown,
      });
    return entries;
  });
}

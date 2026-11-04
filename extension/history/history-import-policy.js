// Source history contains visits, not measured viewing. Keep it as a backfill
// for days before this installation began enforcing the playback threshold.
// After that, only a resume position beyond a minute can establish a watch.
const KEY = "measuredHistoryStart";
const MINIMUM_WATCH_SECONDS = 60;
const pending = new WeakMap();

export function historyImportCutoff(
  storage = chrome.storage.local,
  now = Date.now(),
) {
  if (pending.has(storage)) return pending.get(storage);
  const request = (async () => {
    const stored = (await storage.get(KEY))[KEY];
    if (stored !== undefined) {
      if (!Number.isSafeInteger(stored) || stored <= 0)
        throw new Error("Invalid measured history boundary");
      return stored;
    }
    const date = new Date(now);
    const cutoff = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
    await storage.set({ [KEY]: cutoff });
    return cutoff;
  })();
  pending.set(storage, request);
  void request.finally(() => pending.delete(storage)).catch(() => {});
  return request;
}

export function isMeasuredWatch(video) {
  return video.intTimestamp > 0 && video.resumeSeconds >= MINIMUM_WATCH_SECONDS;
}

export function isHistoricalWatch(video, cutoff) {
  const timestamp = Number(video.intTimestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp >= cutoff)
    return false;
  // A day-only observation must lie entirely before the boundary, including
  // when the browser's timezone has changed since initialization.
  return (video.watchEvents || []).every((event) => {
    if (event.precision !== "day") return event.watchedAt < cutoff;
    const date = new Date(event.watchedAt);
    return (
      new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1,
      ).getTime() <= cutoff
    );
  });
}

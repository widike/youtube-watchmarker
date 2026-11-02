export const TIME_PREFIX = "watch-time:";
export const TIME_OUTBOX = "watch-time-outbox:";

export function normalizeWatchTime(row, snapshotId = row.snapshotId) {
  const eventId = row.eventId || `playback:${snapshotId?.replace(/:\d+$/, "")}`;
  if (
    typeof snapshotId !== "string" ||
    !snapshotId ||
    snapshotId.length > 1024 ||
    typeof eventId !== "string" ||
    !eventId ||
    eventId.length > 1024 ||
    !/^[\w-]{11}$/.test(row.strIdent) ||
    !Number.isSafeInteger(row.minute) ||
    row.minute <= 0 ||
    row.minute % 60_000 ||
    !Number.isSafeInteger(row.from) ||
    !Number.isSafeInteger(row.to) ||
    row.from < row.minute ||
    row.to > row.minute + 60_000 ||
    row.to <= row.from ||
    !Number.isSafeInteger(row.milliseconds) ||
    row.milliseconds <= 0 ||
    row.milliseconds > row.to - row.from ||
    row.milliseconds > 60_000
  )
    throw new Error("Invalid synced playback time");
  const result = {
    snapshotId,
    eventId,
    strIdent: row.strIdent,
    strTitle: String(row.strTitle || "").slice(0, 2000),
    minute: row.minute,
    from: row.from,
    to: row.to,
    milliseconds: row.milliseconds,
    observedDeletion: Number(row.observedDeletion) || 0,
  };
  if (
    !Number.isSafeInteger(result.observedDeletion) ||
    result.observedDeletion < 0
  )
    throw new Error("Invalid playback deletion marker");
  if (row.eventWatchedAt != null) {
    if (!Number.isSafeInteger(row.eventWatchedAt) || row.eventWatchedAt <= 0)
      throw new Error("Invalid playback event date");
    result.eventWatchedAt = row.eventWatchedAt;
  }
  if (row.durationSeconds != null) {
    if (
      !Number.isFinite(row.durationSeconds) ||
      row.durationSeconds <= 0 ||
      !Array.isArray(row.mediaRanges) ||
      row.mediaRanges.length > 500 ||
      row.mediaRanges.some(
        (range) =>
          !Array.isArray(range) ||
          range.length !== 2 ||
          !range.every(Number.isFinite) ||
          range[0] < 0 ||
          range[1] <= range[0] ||
          range[1] > row.durationSeconds,
      )
    )
      throw new Error("Invalid synced playback coverage");
    result.durationSeconds = row.durationSeconds;
    result.mediaRanges = row.mediaRanges;
  }
  return result;
}

export function mergeWatchTime(previous, incoming) {
  const next = normalizeWatchTime(incoming);
  if (!previous) return next;
  const old = normalizeWatchTime(previous, next.snapshotId);
  if (
    [
      "strIdent",
      "eventId",
      "minute",
      "from",
      "observedDeletion",
      "eventWatchedAt",
    ].some((key) => old[key] !== next[key])
  )
    throw new Error("Conflicting playback time identity");
  if (old.milliseconds >= next.milliseconds) return old;
  if (next.to < old.to) throw new Error("Playback time cannot move backwards");
  return next;
}

export const DURATION_PREFIX = "video-duration:";
export const DURATION_OUTBOX = "duration-outbox:";
export const durationRange = (prefix) =>
  IDBKeyRange.bound(prefix, `${prefix}\uffff`);

export function normalizeDuration(row) {
  const unavailable = row.unavailable === true;
  // Old local skip markers have no fetch date. A dated observation replaces them.
  const fetchedAt = row.fetchedAt ?? 0;
  if (
    !/^[\w-]{11}$/.test(row.strIdent) ||
    !Number.isSafeInteger(fetchedAt) ||
    fetchedAt < 0 ||
    (row.seconds !== null &&
      (!Number.isFinite(row.seconds) || row.seconds <= 0)) ||
    (unavailable && row.seconds !== null) ||
    (!unavailable &&
      (!Number.isSafeInteger(row.expiresAt) || row.expiresAt <= fetchedAt))
  )
    throw new Error("Invalid video duration");
  return {
    strIdent: row.strIdent,
    seconds: row.seconds,
    fetchedAt,
    ...(unavailable ? { unavailable: true } : { expiresAt: row.expiresAt }),
  };
}

// Same total ordering as the database trigger, including simultaneous fetches.
export function newerDuration(previous, incoming) {
  if (!previous) return incoming;
  const a = normalizeDuration(previous);
  for (const field of ["fetchedAt", "unavailable", "seconds", "expiresAt"]) {
    const left = Number(a[field]) || 0;
    const right = Number(incoming[field]) || 0;
    if (left !== right) return right > left ? incoming : a;
  }
  return a;
}

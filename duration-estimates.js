import { activityEntries } from "./history-activity.js";
import { dayKey } from "./statistics-dates.js";

function datedEntries(videos, now) {
  return activityEntries(videos, now).filter(
    (entry) =>
      entry.intTimestamp > 0 &&
      entry.intTimestamp <= now &&
      /^[\w-]{11}$/.test(entry.strIdent),
  );
}

export function durationCandidates(videos, now = Date.now()) {
  const latest = new Map();
  for (const entry of datedEntries(videos, now))
    latest.set(
      entry.strIdent,
      Math.max(latest.get(entry.strIdent) || 0, entry.intTimestamp),
    );
  return [...latest]
    .sort(([a, at], [b, bt]) => bt - at || a.localeCompare(b))
    .map(([id]) => id);
}

export function estimateHistoryTime(videos, measured, durations, now) {
  const cache = new Map(
    durations
      .filter((row) => row.expiresAt > now)
      .map((row) => [row.strIdent, row]),
  );
  const recorded = new Set(
    measured
      .filter((row) => row.milliseconds > 0)
      .map((row) => `${row.strIdent}:${row.eventId}`),
  );
  const rows = [];
  const missing = new Map();
  for (const entry of datedEntries(videos, now)) {
    if (recorded.has(entry.entryId)) continue;
    const duration = cache.get(entry.strIdent);
    if (!(duration?.seconds > 0)) {
      const date = dayKey(entry.intTimestamp);
      missing.set(date, (missing.get(date) || 0) + 1);
      continue;
    }
    rows.push({
      strIdent: entry.strIdent,
      minute: entry.intTimestamp,
      from: entry.intTimestamp,
      to: entry.intTimestamp,
      milliseconds: duration.seconds * 1000,
      estimated: true,
      // Day-only imports must not invent a known viewing hour.
      exactHour: entry.watchPrecision === "exact",
    });
  }
  return {
    rows,
    missingDaily: [...missing].map(([date, count]) => ({ date, count })),
  };
}

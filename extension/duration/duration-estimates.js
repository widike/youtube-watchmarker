import { activityEntries } from "../history/history-activity.js";
import { DAY, dayKey } from "../statistics/statistics-dates.js";

// Split inferred intervals at local hour boundaries for calendars and rhythms.
function timedRows(entry, end, simultaneous) {
  const rows = [];
  for (let from = entry.intTimestamp; from < end; ) {
    const date = new Date(from);
    const untilHour =
      (60 - date.getMinutes()) * 60_000 -
      date.getSeconds() * 1000 -
      date.getMilliseconds();
    const to = Math.min(end, from + untilHour);
    rows.push({
      strIdent: entry.strIdent,
      minute: from,
      from,
      to,
      milliseconds: (to - from) / simultaneous,
      estimated: true,
      exactHour: entry.watchPrecision === "exact",
    });
    from = to;
  }
  return rows;
}

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
  const entries = datedEntries(videos, now);
  const simultaneous = new Map();
  for (const entry of entries)
    if (entry.watchPrecision !== "day")
      simultaneous.set(
        entry.intTimestamp,
        (simultaneous.get(entry.intTimestamp) || 0) + 1,
      );
  const starts = [
    ...new Set(
      entries
        .filter((entry) => entry.watchPrecision !== "day")
        .map((entry) => entry.intTimestamp),
    ),
  ].sort((a, b) => a - b);
  const nextStart = new Map(
    starts.map((at, index) => [at, starts[index + 1] ?? now]),
  );
  for (const entry of entries) {
    if (recorded.has(entry.entryId)) continue;
    const duration = cache.get(entry.strIdent);
    // Cached video length is only an upper bound, never proof of watch time.
    const hasDuration =
      Number.isFinite(duration?.seconds) && duration.seconds > 0;
    const hasNext = entry.intTimestamp < starts.at(-1);
    if (!hasDuration && (entry.watchPrecision === "day" || !hasNext)) {
      const date = dayKey(entry.intTimestamp);
      missing.set(date, (missing.get(date) || 0) + 1);
      continue;
    }
    if (entry.watchPrecision !== "day") {
      rows.push(
        ...timedRows(
          entry,
          Math.min(
            hasDuration
              ? entry.intTimestamp + duration.seconds * 1000
              : Infinity,
            entry.intTimestamp + DAY,
            nextStart.get(entry.intTimestamp),
            now,
          ),
          simultaneous.get(entry.intTimestamp),
        ),
      );
      continue;
    }
    rows.push({
      strIdent: entry.strIdent,
      minute: entry.intTimestamp,
      from: entry.intTimestamp,
      to: entry.intTimestamp,
      milliseconds: Math.min(duration.seconds * 1000, DAY),
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

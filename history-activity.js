import { historyEntries } from "./history-events.js";
import { isDeleted } from "./history-records.js";
import { dayKey } from "./statistics-dates.js";

/**
 * Imports are observations, not independently identified playback sessions.
 * A midnight YouTube date, browser URL visit and migrated last-watch timestamp
 * can all describe the same activity. Count at most one imported observation
 * per video/local day, and none when that day has tracked sessions. Preserve
 * every tracked session, including same-millisecond replays. Raw immutable
 * events remain untouched for sync, backups and future reconciliation.
 */
export function activityEntries(videos, now = Date.now()) {
  const groups = new Map();
  const other = [];
  for (const entry of historyEntries(
    videos.filter((video) => !isDeleted(video)),
  )) {
    // Future evidence must not suppress an observation already in the period.
    if (!entry.intTimestamp || entry.intTimestamp > now) {
      other.push(entry);
      continue;
    }
    const key = `${entry.strIdent}:${dayKey(entry.intTimestamp)}`;
    if (!groups.has(key)) groups.set(key, { tracked: [], imported: null });
    const group = groups.get(key);
    if (entry.watchSource === "playback") group.tracked.push(entry);
    else if (
      !group.imported ||
      entry.intTimestamp > group.imported.intTimestamp
    )
      group.imported = entry;
  }
  return other.concat(
    [...groups.values()].flatMap(({ tracked, imported }) =>
      tracked.length ? tracked : [imported],
    ),
  );
}

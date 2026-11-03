import { newerDuration } from "../../extension/duration/duration-records.js";
import { mergeVideoData } from "../../extension/history/history-records.js";

export function remote() {
  const records = new Map();
  const times = new Map();
  const durations = new Map();
  return {
    durations,
    importDurations: async (rows) => {
      for (const row of rows)
        durations.set(
          row.strIdent,
          newerDuration(durations.get(row.strIdent), row),
        );
      return true;
    },
    getDurationPage: async (after) =>
      [...durations.values()]
        .filter((row) => row.strIdent > after)
        .sort((a, b) => (a.strIdent < b.strIdent ? -1 : 1))
        .slice(0, 2),
    times,
    importWatchTime: async (rows) => {
      for (const row of rows)
        if ((times.get(row.snapshotId)?.milliseconds || 0) < row.milliseconds)
          times.set(row.snapshotId, row);
      return true;
    },
    getWatchTimePage: async (after) =>
      [...times.values()]
        .filter((row) => row.snapshotId > after)
        .sort((a, b) => (a.snapshotId < b.snapshotId ? -1 : 1))
        .slice(0, 2),
    isConnected: true,
    records,
    importVideos: async (rows) => {
      for (const row of rows)
        records.set(
          row.strIdent,
          mergeVideoData([records.get(row.strIdent)].filter(Boolean), [row])[0],
        );
      return true;
    },
    getVideoPage: async (after) =>
      [...records.values()]
        .filter((row) => row.strIdent > after)
        .sort((a, b) => a.strIdent.localeCompare(b.strIdent))
        .slice(0, 2),
  };
}

import { newerDuration } from "../../extension/duration/duration-records.js";
import { mergeVideoData } from "../../extension/history/history-records.js";

export function remote() {
  const records = new Map();
  const times = new Map();
  const durations = new Map();
  const revisions = {
    history: new Map(),
    watchTime: new Map(),
    durations: new Map(),
  };
  let clock = 0n;
  const store = (collection, map, id, row) => {
    if (JSON.stringify(map.get(id)) !== JSON.stringify(row)) {
      map.set(id, row);
      revisions[collection].set(id, ++clock);
    }
  };
  const page = (collection, map, after, key, window) =>
    [...map.values()]
      .filter(
        (row) =>
          row[key] > after &&
          (!window ||
            (revisions[collection].get(row[key]) > BigInt(window.since) &&
              revisions[collection].get(row[key]) <= BigInt(window.until))),
      )
      .sort((a, b) => (a[key] < b[key] ? -1 : 1))
      .slice(0, 2);
  return {
    getSyncState: async () => ({
      version: 1,
      owner: "00000000-0000-4000-8000-000000000001",
      revisions: Object.fromEntries(
        Object.entries(revisions).map(([collection, values]) => [
          collection,
          [...values.values()].reduce((a, b) => (a > b ? a : b), 0n).toString(),
        ]),
      ),
    }),
    durations,
    importDurations: async (rows) => {
      for (const row of rows)
        store(
          "durations",
          durations,
          row.strIdent,
          newerDuration(durations.get(row.strIdent), row),
        );
      return true;
    },
    getDurationPage: async (after, _limit, window) =>
      page("durations", durations, after, "strIdent", window),
    times,
    importWatchTime: async (rows) => {
      for (const row of rows)
        if ((times.get(row.snapshotId)?.milliseconds || 0) < row.milliseconds)
          store("watchTime", times, row.snapshotId, row);
      return true;
    },
    getWatchTimePage: async (after, _limit, window) =>
      page("watchTime", times, after, "snapshotId", window),
    isConnected: true,
    records,
    importVideos: async (rows) => {
      for (const row of rows)
        store(
          "history",
          records,
          row.strIdent,
          mergeVideoData([records.get(row.strIdent)].filter(Boolean), [row])[0],
        );
      return true;
    },
    getVideoPage: async (after, _limit, window) =>
      page("history", records, after, "strIdent", window),
  };
}

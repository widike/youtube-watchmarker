import { readMetadata, writeMetadata } from "./history-storage.js";
import {
  watchTimePage,
  pendingWatchTime,
  queueWatchTime,
  acknowledgeWatchTime,
} from "./watch-time-replication.js";

export async function uploadPendingWatchTime(
  db,
  remote,
  { now = Date.now, deadline = now() + 6000 } = {},
) {
  let uploaded = 0;
  const repair = (await readMetadata(db, "watchTimeRepair")) || {
    after: "",
    completedAt: 0,
  };
  let repairComplete = true;
  if (!repair.completedAt) {
    repairComplete = false;
    while (now() < deadline) {
      const rows = await watchTimePage(db, repair.after);
      if (!rows.length) {
        repairComplete = true;
        await writeMetadata(db, "watchTimeRepair", {
          after: "",
          completedAt: now(),
        });
        break;
      }
      await queueWatchTime(db, rows);
      repair.after = rows.at(-1).snapshotId;
      await writeMetadata(db, "watchTimeRepair", repair);
    }
  }
  while (now() < deadline) {
    const entries = await pendingWatchTime(db);
    if (!entries.length) break;
    if (!(await remote.importWatchTime(entries.map(({ row }) => row))))
      throw new Error("Playback time upload was not acknowledged");
    await acknowledgeWatchTime(db, entries);
    uploaded += entries.length;
  }
  return {
    uploaded,
    complete: repairComplete && !(await pendingWatchTime(db, 1)).length,
  };
}

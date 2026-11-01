import { readMetadata, writeMetadata } from "./history-storage.js";
import {
  watchTimePage,
  pendingWatchTime,
  queueWatchTime,
  acknowledgeWatchTime,
  mergeWatchTimes,
} from "./watch-time-replication.js";

export async function syncWatchTime(
  db,
  remote,
  { now = Date.now, deadline = now() + 6000, forceDownload = true } = {},
) {
  let uploaded = 0;
  let downloaded = 0;
  const repair = (await readMetadata(db, "watchTimeRepair")) || {
    after: "",
    completedAt: 0,
  };
  let repairComplete = true;
  if (
    !repair.completedAt ||
    now() < repair.completedAt ||
    now() - repair.completedAt >= 86_400_000
  ) {
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
  let after = (await readMetadata(db, "watchTimeDownloadAfter")) || "";
  const last = (await readMetadata(db, "watchTimeLastDownload")) || 0;
  const shouldDownload =
    forceDownload || after || !last || now() < last || now() - last >= 300_000;
  let complete = !shouldDownload;
  while (shouldDownload && now() < deadline) {
    const rows = await remote.getWatchTimePage(after);
    if (!rows.length) {
      await writeMetadata(db, "watchTimeDownloadAfter", "");
      await writeMetadata(db, "watchTimeLastDownload", now());
      complete = true;
      break;
    }
    await mergeWatchTimes(db, rows);
    after = rows.at(-1).snapshotId;
    await writeMetadata(db, "watchTimeDownloadAfter", after);
    downloaded += rows.length;
  }
  return {
    uploaded,
    downloaded,
    complete:
      complete && repairComplete && !(await pendingWatchTime(db, 1)).length,
  };
}

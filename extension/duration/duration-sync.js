import { readMetadata, writeMetadata } from "../history/history-storage.js";
import { normalizeDuration } from "./duration-records.js";
import {
  durationPage,
  pendingDurations,
  queueDurations,
  acknowledgeDurations,
  mergeDurations,
} from "./duration-replication.js";

export async function syncDurations(
  db,
  remote,
  {
    now = Date.now,
    deadline = now() + 4000,
    forceDownload = true,
    onDownloaded = async () => {},
  } = {},
) {
  let uploaded = 0;
  let downloaded = 0;
  const repair = (await readMetadata(db, "durationRepair")) || {
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
      const rows = await durationPage(db, repair.after);
      if (!rows.length) {
        await writeMetadata(db, "durationRepair", {
          after: "",
          completedAt: now(),
        });
        repairComplete = true;
        break;
      }
      await queueDurations(
        db,
        rows.filter((row) => row.unavailable || row.expiresAt > now()),
      );
      repair.after = rows.at(-1).strIdent;
      await writeMetadata(db, "durationRepair", repair);
    }
  }
  while (now() < deadline) {
    const entries = await pendingDurations(db);
    if (!entries.length) break;
    const rows = entries
      .map(({ row }) => row)
      .filter((row) => row.unavailable || row.expiresAt > now());
    if (rows.length && !(await remote.importDurations(rows)))
      throw new Error("Video duration upload was not acknowledged");
    await acknowledgeDurations(db, entries);
    uploaded += rows.length;
  }
  let after = (await readMetadata(db, "durationDownloadAfter")) || "";
  const last = (await readMetadata(db, "durationLastDownload")) || 0;
  const shouldDownload =
    forceDownload || after || !last || now() < last || now() - last >= 300_000;
  let complete = !shouldDownload;
  while (shouldDownload && now() < deadline) {
    const rows = (await remote.getDurationPage(after)).map(normalizeDuration);
    if (
      rows.some(
        (row, index) =>
          row.strIdent <= (index ? rows[index - 1].strIdent : after),
      )
    )
      throw new Error("Invalid video duration page order");
    if (!rows.length) {
      await writeMetadata(db, "durationDownloadAfter", "");
      await writeMetadata(db, "durationLastDownload", now());
      complete = true;
      break;
    }
    const changed = await mergeDurations(
      db,
      rows.filter((row) => row.unavailable || row.expiresAt > now()),
    );
    if (changed) await onDownloaded();
    after = rows.at(-1).strIdent;
    await writeMetadata(db, "durationDownloadAfter", after);
    downloaded += rows.length;
  }
  return {
    uploaded,
    downloaded,
    complete:
      complete && repairComplete && !(await pendingDurations(db, 1)).length,
  };
}

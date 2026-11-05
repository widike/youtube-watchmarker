import { readMetadata, writeMetadata } from "../history/history-storage.js";
import {
  durationPage,
  pendingDurations,
  queueDurations,
  acknowledgeDurations,
} from "./duration-replication.js";

export async function uploadPendingDurations(
  db,
  remote,
  { now = Date.now, deadline = now() + 4000 } = {},
) {
  let uploaded = 0;
  const repair = (await readMetadata(db, "durationRepair")) || {
    after: "",
    completedAt: 0,
  };
  let repairComplete = true;
  if (!repair.completedAt) {
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
  return {
    uploaded,
    complete: repairComplete && !(await pendingDurations(db, 1)).length,
  };
}

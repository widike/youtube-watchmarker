import {
  acknowledgeVideos,
  localPage,
  pendingVideos,
  readMetadata,
  saveVideos,
  writeMetadata,
} from "../history/history-storage.js";
export { mergeVideoData } from "../history/history-records.js";

import { uploadPendingWatchTime } from "../history/watch-time-sync.js";
import { uploadPendingDurations } from "../duration/duration-sync.js";
import { mergeWatchTimes } from "../history/watch-time-replication.js";
import { mergeDurations } from "../duration/duration-replication.js";
import { downloadChanges } from "./sync-window.js";

export async function importVideosInBatches(provider, videos, batchSize = 100) {
  for (let i = 0; i < videos.length; i += batchSize) {
    await provider.importVideos(videos.slice(i, i + batchSize));
  }
  return videos.length;
}

// Watch dates never serve as sync watermarks: old imports are new server changes.
export class HistorySync {
  constructor(db, remote, now = Date.now, durationsChanged = async () => {}) {
    this.db = db;
    this.remote = remote;
    this.now = now;
    this.durationsChanged = durationsChanged;
    this.running = null;
  }

  sync({ state } = {}) {
    if (!this.running) {
      this.running = this.run(state).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async run(state) {
    const deadline = this.now() + 20_000;
    let uploaded = 0;
    let downloaded = 0;
    try {
      // Seed pre-outbox installations once. Durable outboxes handle all later
      // changes; elapsed time is not evidence that the cloud lost every row.
      const repair = (await readMetadata(this.db, "repair")) || {
        completedAt: 0,
        after: "",
      };
      let repairComplete = Boolean(repair.completedAt);
      if (!repair.completedAt) {
        while (this.now() < deadline) {
          const rows = await localPage(this.db, repair.after);
          if (!rows.length) {
            repairComplete = true;
            await writeMetadata(this.db, "repair", {
              completedAt: this.now(),
              after: "",
            });
            break;
          }
          await saveVideos(this.db, rows);
          repair.after = rows.at(-1).strIdent;
          await writeMetadata(this.db, "repair", repair);
        }
      }
      if (!this.remote.isConnected) await this.remote.init();
      while (this.now() < deadline) {
        const entries = await pendingVideos(this.db);
        if (!entries.length) break;
        const success = await this.remote.importVideos(
          entries.map((entry) => entry.video),
        );
        if (!success) throw new Error("Upload was not acknowledged");
        await acknowledgeVideos(this.db, entries);
        uploaded += entries.length;
      }
      const time = await uploadPendingWatchTime(this.db, this.remote, {
        now: this.now,
        deadline: Math.min(deadline, this.now() + 6000),
      });
      const durations = await uploadPendingDurations(this.db, this.remote, {
        now: this.now,
        deadline: Math.min(deadline, this.now() + 4000),
      });
      // Refresh after uploads so server-side conflict merges return immediately.
      if (!state || uploaded || time.uploaded || durations.uploaded)
        state = await this.remote.getSyncState();
      const results = {};
      const collections = [
        [
          "history",
          "getVideoPage",
          "strIdent",
          (rows) => saveVideos(this.db, rows, { pending: false }),
        ],
        [
          "watchTime",
          "getWatchTimePage",
          "snapshotId",
          (rows) => mergeWatchTimes(this.db, rows),
        ],
        [
          "durations",
          "getDurationPage",
          "strIdent",
          async (rows) => {
            const changed = await mergeDurations(
              this.db,
              rows.filter(
                (row) => row.unavailable || row.expiresAt > this.now(),
              ),
            );
            if (changed) await this.durationsChanged();
          },
        ],
      ];
      for (const [collection, method, key, merge] of collections)
        results[collection] = await downloadChanges({
          storage: {
            get: (key) => readMetadata(this.db, key),
            set: (key, value) => writeMetadata(this.db, key, value),
          },
          collection,
          latest: state.revisions[collection],
          page: (...args) => this.remote[method](...args),
          merge,
          key: (row) => row[key],
          now: this.now,
          deadline,
        });
      downloaded = results.history.downloaded;
      const complete =
        repairComplete &&
        Object.values(results).every((result) => result.complete);
      const pending = (await pendingVideos(this.db, 1)).length > 0;
      const previous = (await readMetadata(this.db, "syncStatus")) || {};
      const status = {
        ...previous,
        error: null,
        uploaded,
        downloaded,
        timeUploaded: time.uploaded,
        timeDownloaded: results.watchTime.downloaded,
        durationsUploaded: durations.uploaded,
        durationsDownloaded: results.durations.downloaded,
        inProgress:
          !complete || pending || !time.complete || !durations.complete,
        lastAttempt: this.now(),
        lastSuccess:
          complete && !pending && time.complete && durations.complete
            ? this.now()
            : previous.lastSuccess || 0,
      };
      await writeMetadata(this.db, "syncStatus", status);
      return { ...status, success: true };
    } catch (error) {
      const previous = (await readMetadata(this.db, "syncStatus")) || {};
      await writeMetadata(this.db, "syncStatus", {
        ...previous,
        error: error.message,
        lastAttempt: this.now(),
        inProgress: false,
      });
      return { success: false, error: error.message };
    }
  }
}

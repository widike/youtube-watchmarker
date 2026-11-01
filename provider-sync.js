import {
  acknowledgeVideos,
  localPage,
  pendingVideos,
  readMetadata,
  saveVideos,
  writeMetadata,
} from "./history-storage.js";
export { mergeVideoData } from "./history-records.js";

import { syncWatchTime } from "./watch-time-sync.js";

const DAY = 24 * 60 * 60 * 1000;

export async function importVideosInBatches(provider, videos, batchSize = 100) {
  for (let i = 0; i < videos.length; i += batchSize) {
    await provider.importVideos(videos.slice(i, i + batchSize));
  }
  return videos.length;
}

// No watch-date watermark: imports can contain arbitrarily old watches.
// The outbox tracks local changes; stable ID pages reconcile the remote union.
export class HistorySync {
  constructor(db, remote, now = Date.now) {
    this.db = db;
    this.remote = remote;
    this.now = now;
    this.running = null;
  }

  sync({ forceDownload = true } = {}) {
    if (!this.running) {
      this.running = this.run(forceDownload).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async run(forceDownload) {
    const deadline = this.now() + 20_000;
    let uploaded = 0;
    let downloaded = 0;
    try {
      // Repair missing cloud rows daily, including after a cloud restore.
      // Cursor progress is durable, so a worker restart resumes safely.
      const repair = (await readMetadata(this.db, "repair")) || {
        completedAt: 0,
        after: "",
      };
      if (
        this.now() < repair.completedAt ||
        this.now() - repair.completedAt >= DAY
      ) {
        while (this.now() < deadline) {
          const rows = await localPage(this.db, repair.after);
          if (!rows.length) {
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
      const time = await syncWatchTime(this.db, this.remote, {
        now: this.now,
        deadline: Math.min(deadline, this.now() + 6000),
        forceDownload,
      });
      let after = (await readMetadata(this.db, "downloadAfter")) || "";
      const lastDownload = (await readMetadata(this.db, "lastDownload")) || 0;
      const shouldDownload =
        forceDownload ||
        after ||
        this.now() < lastDownload ||
        this.now() - lastDownload >= 5 * 60_000;
      let complete = !shouldDownload;
      while (shouldDownload && this.now() < deadline) {
        const rows = await this.remote.getVideoPage(after);
        if (!rows.length) {
          await writeMetadata(this.db, "downloadAfter", "");
          await writeMetadata(this.db, "lastDownload", this.now());
          complete = true;
          break;
        }
        await saveVideos(this.db, rows, { pending: false });
        after = rows.at(-1).strIdent;
        await writeMetadata(this.db, "downloadAfter", after);
        downloaded += rows.length;
      }
      const pending = (await pendingVideos(this.db, 1)).length > 0;
      const previous = (await readMetadata(this.db, "syncStatus")) || {};
      const status = {
        ...previous,
        error: null,
        uploaded,
        downloaded,
        timeUploaded: time.uploaded,
        timeDownloaded: time.downloaded,
        inProgress: !complete || pending || !time.complete,
        lastAttempt: this.now(),
        lastSuccess:
          shouldDownload && complete && !pending && time.complete
            ? this.now()
            : previous.lastSuccess || 0,
      };
      await writeMetadata(this.db, "syncStatus", status);
      return { success: true, ...status };
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

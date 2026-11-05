const CURSOR_KEY = "watchmarker_blocked_videos_cursor";

// Unblocks are durable tombstones. An offline device's old block cannot restore
// a video after another device unblocks it. Acknowledgement is revision-specific.
export class BlockedVideoSync {
  constructor(store, remote, now = Date.now) {
    Object.assign(this, { store, remote, now });
  }

  sync() {
    if (!this.running)
      this.running = this.run().finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async run() {
    const deadline = this.now() + 10_000;
    let uploaded = 0;
    let downloaded = 0;
    while (this.now() < deadline) {
      const entries = (await this.store.pendingRecords()).slice(0, 100);
      if (!entries.length) break;
      if (!(await this.remote.importBlockedVideos(entries)))
        throw new Error("Blocked-video upload was not acknowledged");
      await this.store.acknowledge(entries);
      uploaded += entries.length;
    }
    let after = (await this.store.storage.get(CURSOR_KEY))[CURSOR_KEY] || "";
    while (this.now() < deadline) {
      const rows = await this.remote.getBlockedVideoPage(after);
      if (
        rows.some(
          (row, index) =>
            row.videoId <= (index ? rows[index - 1].videoId : after),
        )
      )
        throw new Error("Invalid blocked-video page order");
      if (!rows.length) {
        await this.store.storage.set({ [CURSOR_KEY]: "" });
        return {
          uploaded,
          downloaded,
          complete: !(await this.store.pendingRecords()).length,
        };
      }
      await this.store.merge(rows);
      downloaded += rows.length;
      after = rows.at(-1).videoId;
      await this.store.storage.set({ [CURSOR_KEY]: after });
    }
    return { uploaded, downloaded, complete: false };
  }
}

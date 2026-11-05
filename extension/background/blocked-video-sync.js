import { downloadChanges } from "../providers/sync-window.js";

// Unblocks are durable tombstones. An offline device's old block cannot restore
// a video after another device unblocks it. Acknowledgement is revision-specific.
export class BlockedVideoSync {
  constructor(store, remote, now = Date.now) {
    Object.assign(this, { store, remote, now });
  }

  sync({ state } = {}) {
    if (!this.running)
      this.running = this.run(state).finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async run(state) {
    const deadline = this.now() + 10_000;
    let uploaded = 0;
    while (this.now() < deadline) {
      const entries = (await this.store.pendingRecords()).slice(0, 100);
      if (!entries.length) break;
      if (!(await this.remote.importBlockedVideos(entries)))
        throw new Error("Blocked-video upload was not acknowledged");
      await this.store.acknowledge(entries);
      uploaded += entries.length;
    }
    if (!state || uploaded) state = await this.remote.getSyncState();
    const result = await downloadChanges({
      storage: {
        get: async (key) =>
          (await this.store.storage.get(`${key}:${state.owner}`))[
            `${key}:${state.owner}`
          ],
        set: (key, value) =>
          this.store.storage.set({ [`${key}:${state.owner}`]: value }),
      },
      collection: "blocked",
      latest: state.revisions.blocked,
      page: (...args) => this.remote.getBlockedVideoPage(...args),
      merge: (rows) => this.store.merge(rows),
      key: (row) => row.videoId,
      now: this.now,
      deadline,
    });
    return {
      uploaded,
      ...result,
      complete: result.complete && !(await this.store.pendingRecords()).length,
    };
  }
}

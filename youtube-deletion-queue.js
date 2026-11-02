import { deleteFromHistory } from "./youtube-history-delete.js";
import {
  META_STORE,
  readMetadata,
  readRequest,
  transactionDone,
} from "./history-storage.js";

const PREFIX = "youtubeDeletion:";

export class YouTubeDeletionQueue {
  constructor(db, remove = deleteFromHistory) {
    this.db = db;
    this.remove = remove;
    this.running = new Map();
  }

  // Compare revisions in the transaction: finishing an earlier request must
  // never acknowledge a second explicit deletion of the same video.
  async update(job, value) {
    const tx = this.db.transaction(META_STORE, "readwrite", {
      durability: "strict",
    });
    const done = transactionDone(tx);
    const store = tx.objectStore(META_STORE);
    const key = `${PREFIX}${job.videoId}`;
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result?.revision !== job.revision) return;
      if (value) store.put(value, key);
      else store.delete(key);
    };
    await done;
  }

  process(videoId) {
    if (!this.running.has(videoId)) {
      this.running.set(
        videoId,
        this.run(videoId).finally(() => this.running.delete(videoId)),
      );
    }
    return this.running.get(videoId);
  }

  async run(videoId) {
    let job = await readMetadata(this.db, `${PREFIX}${videoId}`);
    if (!job) return { success: true };
    try {
      const result = await this.remove(videoId, {
        state: job.state,
        signal: AbortSignal.timeout(15_000),
        checkpoint: async (state) => {
          job = { ...job, state };
          await this.update(job, job);
        },
      });
      await this.update(
        job,
        result.success ? null : { ...job, error: result.error },
      );
      if (
        result.success &&
        (await readMetadata(this.db, `${PREFIX}${videoId}`))
      )
        return {
          success: false,
          error: "A newer YouTube deletion is pending.",
        };
      return result;
    } catch (error) {
      await this.update(job, { ...job, error: error.message });
      return { success: false, error: error.message };
    }
  }

  async pending() {
    const tx = this.db.transaction(META_STORE, "readonly");
    return readRequest(
      tx
        .objectStore(META_STORE)
        .getAll(IDBKeyRange.bound(PREFIX, `${PREFIX}\uffff`)),
    );
  }

  async retry() {
    const jobs = await this.pending();
    // One bounded request per alarm; failed sign-in cannot block other jobs.
    const job = jobs.sort(
      (a, b) => (a.lastAttempt || 0) - (b.lastAttempt || 0),
    )[0];
    if (!job) return;
    await this.update(job, { ...job, lastAttempt: Date.now() });
    return this.process(job.videoId);
  }
}

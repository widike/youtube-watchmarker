import { DATABASE } from "../../extension/shared/constants.js";
import { IndexedDBProvider } from "../../extension/providers/indexeddb-provider.js";
import { YoutubeManager } from "../../extension/sources/bg-youtube.js";
import { VideoTracker } from "../../extension/background/video-tracker.js";
import {
  OUTBOX_STORE,
  pendingVideos,
  readMetadata,
  deleteVideo,
} from "../../extension/history/history-storage.js";

const id = "abcdefghijk";
const sender = {
  tab: { id: 1 },
  documentId: "document",
  frameId: 0,
  url: `https://www.youtube.com/watch?v=${id}`,
};
const event = (sessionId = "00000000-0000-4000-8000-000000000001") => ({
  videoId: id,
  sessionId,
  reason: "progress",
  watchedMilliseconds: 60_000,
  title: "Grüße 😀",
});

async function setup(db) {
  const provider = new IndexedDBProvider({
    database: db,
    isInitialized: true,
    STORE_NAME: DATABASE.STORE_NAME,
  });
  await provider.init();
  const manager = new YoutubeManager();
  manager.setProviderFactory({ getCurrentProvider: () => provider });
  const tracker = new VideoTracker();
  await tracker.initialize(manager);
  return { provider, tracker };
}

export async function testPlaybackDurability({ test, database, open, assert }) {
  globalThis.chrome = {
    storage: {
      sync: { get: async (key) => ({ [key]: true }) },
      session: {
        get: async () => {
          throw new Error("Separate session storage is unavailable");
        },
        set: async () => {
          throw new Error("Separate session storage is unavailable");
        },
      },
    },
    tabs: { query: async () => [] },
  };

  await test("sub-minute playback commits no history or upload obligation", async () => {
    const db = await database();
    const { provider, tracker } = await setup(db);
    for (const reason of ["navigation", "progress", "rating"]) {
      const result = await tracker.recordWatch(
        { ...event(), reason, watchedMilliseconds: 59_999 },
        sender,
      );
      assert(result === null, "Sub-minute playback reported a saved watch");
    }
    assert(
      (await provider.getVideo(id)) === null,
      "Sub-minute playback entered history",
    );
    assert(
      (await pendingVideos(db)).length === 0,
      "Sub-minute playback entered the outbox",
    );
    assert(
      (await tracker.recordWatch(event(), sender)).intCount === 1,
      "Qualified playback did not record its first watch",
    );
  });

  await test("lost playback acknowledgement and a reopened database cannot double-count a view", async () => {
    let db = await database();
    const name = db.name;
    let { provider, tracker } = await setup(db);
    const commit = provider.recordPlayback.bind(provider);
    provider.recordPlayback = async (...args) => {
      await commit(...args);
      throw new Error("Worker stopped after committing the watch");
    };
    try {
      await tracker.recordWatch(event(), sender);
    } catch {
      /* Lost reply. */
    }
    assert(
      (await provider.getVideo(id)).intCount === 1,
      "initial watch was not committed",
    );
    db.close();
    db = await open(name, 2, () => {});
    ({ provider, tracker } = await setup(db));
    assert(
      (await tracker.recordWatch(event(), sender)).intCount === 1,
      "retry counted a second view",
    );
    const next = event("00000000-0000-4000-8000-000000000002");
    await Promise.all([
      tracker.recordWatch(next, sender),
      tracker.recordWatch(next, sender),
    ]);
    assert(
      (await provider.getVideo(id)).intCount === 2,
      "a genuine new playback was not counted exactly once",
    );
    assert(
      (await pendingVideos(db))[0].video.intCount === 2,
      "outbox diverged from history",
    );
  });

  await test("an aborted playback commits neither its count nor its receipt", async () => {
    const db = await database();
    const { provider, tracker } = await setup(db);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === OUTBOX_STORE)
        throw new Error("Interrupted upload obligation write");
      return put.apply(this, args);
    };
    let failed = false;
    try {
      await tracker.recordWatch(event(), sender);
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    assert(failed, "aborted playback reported success");
    assert(
      (await provider.getVideo(id)) === null,
      "watch survived an aborted transaction",
    );
    assert(
      (await readMetadata(db, `playbacks:${id}`)) === undefined,
      "receipt survived an aborted transaction",
    );
    assert(
      (await pendingVideos(db)).length === 0,
      "aborted outbox write survived",
    );
    assert(
      (await tracker.recordWatch(event(), sender)).intCount === 1,
      "retry lost or duplicated the watch",
    );
  });

  await test("retrying an old playback preserves trash; a new playback restores and increments it", async () => {
    const db = await database();
    const { provider, tracker } = await setup(db);
    await tracker.recordWatch(event(), sender);
    await deleteVideo(db, id);
    assert(
      (await tracker.recordWatch(event(), sender)) === null,
      "old playback restored trash",
    );
    assert((await provider.getVideo(id)) === null, "trash became visible");
    const restored = await tracker.recordWatch(
      event("00000000-0000-4000-8000-000000000002"),
      sender,
    );
    assert(restored.intCount === 2, "restoration lost the repeat view");
    assert(
      restored.intTimestamp > restored.intDeletedAt,
      "new playback did not restore the record",
    );
    assert(
      (await provider.getAllVideos()).length === 1,
      "restored record is not visible",
    );
  });
}

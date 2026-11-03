import { readVideos } from "../../extension/history/history-event-storage.js";
import {
  localPage,
  saveVideos,
  deleteVideo,
} from "../../extension/history/history-storage.js";
import { IndexedDBProvider } from "../../extension/providers/indexeddb-provider.js";
import { recordPlayback } from "../../extension/history/history-playback.js";

export async function testHistoryReads({ test, database, assert }) {
  await test("bulk history reads preserve events and bound single-video and paged queries", async () => {
    const db = await database();
    const records = Array.from({ length: 1000 }, (_, index) => ({
      strIdent: String(index).padStart(11, "a"),
      strTitle: `Video ${index}`,
      intTimestamp: index + 1,
      intImportedCount: 0,
      watchEvents: ["z", "a"].map((suffix) => ({
        eventId: `playback:${suffix}`,
        watchedAt: index + 1,
        source: "playback",
        precision: "exact",
        observedDeletion: 0,
      })),
    }));
    records.push({ strIdent: "zzzzzzzzzzz", intTimestamp: 0, intCount: 3 });
    try {
      await saveVideos(db, records);
      let reads = 0;
      const getAll = IDBObjectStore.prototype.getAll;
      IDBObjectStore.prototype.getAll = function (...args) {
        if (this.transaction.db === db) reads++;
        return getAll.apply(this, args);
      };
      let all;
      try {
        all = await readVideos(db);
      } finally {
        IDBObjectStore.prototype.getAll = getAll;
      }
      assert(reads === 2, `History took ${reads} database requests`);
      assert(all.length === 1001, "Bulk read lost summaries");
      for (const row of all.slice(0, -1)) {
        assert(row.watchEvents.length === 2, "Bulk read lost a rewatch");
        assert(
          row.watchEvents[0].eventId === "playback:a" &&
            row.watchEvents.every(
              (event) => event.watchedAt === row.intTimestamp,
            ),
          "Events were reordered or assigned to another video",
        );
      }
      assert(all.at(-1).watchEvents.length === 0, "Invented undated events");
      const page = await localPage(db, all[498].strIdent, 2);
      assert(
        JSON.stringify(page) === JSON.stringify(all.slice(499, 501)),
        "Paged read changed summaries or events",
      );
      const one = await readVideos(db, { id: all[500].strIdent });
      assert(
        JSON.stringify(one) === JSON.stringify(all[500]),
        "Single read differs",
      );
      assert(
        (await readVideos(db, { id: "missing" })) === null,
        "Missing ID exists",
      );
      assert(
        (await localPage(db, "zzzzzzzzzzz", 10)).length === 0,
        "Empty page has data",
      );
      const provider = new IndexedDBProvider({
        database: db,
        isInitialized: true,
      });
      // Counting summaries must not load every watch event a second time.
      provider.getAllVideos = () => {
        throw new Error("Count read watch events");
      };
      assert(
        (await provider.getVideoCount()) === 1001,
        "Count lost undated videos",
      );
      await deleteVideo(db, all[0].strIdent);
      assert(
        (await provider.getVideoCount()) === 1000,
        "Count includes deleted video",
      );
      await recordPlayback(db, all[0].strIdent, "Restored", "restore");
      assert(
        (await provider.getVideoCount()) === 1001,
        "Count lost restored video",
      );
    } finally {
      db.close();
      indexedDB.deleteDatabase(db.name);
    }
  });
}

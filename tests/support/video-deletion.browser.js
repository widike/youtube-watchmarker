import {
  deleteVideo,
  readMetadata,
  localPage,
  pendingVideos,
  saveVideos,
  acknowledgeVideos,
} from "../../extension/history/history-storage.js";
import { YouTubeDeletionQueue } from "../../extension/sources/youtube-deletion-queue.js";
import { isDeleted } from "../../extension/history/history-records.js";
import { DatabaseProviderFactory } from "../../extension/providers/database-provider-factory.js";
import { credentialStorage } from "../../extension/providers/credential-storage.js";
import { supabaseDatabaseProvider } from "../../extension/providers/supabase-database-provider.js";

export async function testVideoDeletion({ test, database, assert }) {
  const id = "aaaaaaaaaaa";
  await test("deletion and both retry obligations survive reopening IndexedDB", async () => {
    const db = await database();
    await saveVideos(db, [{ strIdent: id, intTimestamp: 100 }]);
    await deleteVideo(db, id, { youtube: true });
    assert(isDeleted((await localPage(db))[0]), "local video was not deleted");
    assert(
      (await pendingVideos(db))[0].video.intDeletedAt > 0,
      "cloud deletion not queued",
    );
    const name = db.name;
    db.close();
    const reopened = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const job = await readMetadata(reopened, `youtubeDeletion:${id}`);
    assert(job?.videoId === id, "YouTube deletion not durable");
    const failed = new YouTubeDeletionQueue(
      reopened,
      async (_id, { checkpoint }) => {
        await checkpoint({ nextToken: "older" });
        throw new Error("Offline");
      },
    );
    assert(!(await failed.process(id)).success, "failure acknowledged");
    assert(
      (await failed.pending())[0].state.nextToken === "older",
      "checkpoint lost",
    );
    const retry = new YouTubeDeletionQueue(reopened, async (_id, { state }) => {
      assert(state.nextToken === "older", "worker restart lost cursor");
      return { success: true };
    });
    assert((await retry.retry()).success, "retry did not finish");
    assert((await retry.pending()).length === 0, "completed job still queued");
    assert(
      (await pendingVideos(reopened)).length === 1,
      "YouTube acknowledged cloud prematurely",
    );
    reopened.close();
  });

  await test("finishing an old YouTube deletion cannot acknowledge a newer deletion", async () => {
    const db = await database();
    await deleteVideo(db, id, { youtube: true });
    let finish;
    const queue = new YouTubeDeletionQueue(
      db,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = queue.process(id);
    while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
    assert(queue.process(id) === first, "concurrent request duplicated");
    await deleteVideo(db, id, { youtube: true });
    const newer = (await queue.pending())[0].revision;
    finish({ success: true });
    assert(!(await first).success, "newer deletion falsely reported complete");
    assert((await queue.pending())[0].revision === newer, "newer job lost");
    db.close();
  });

  await test("cloud deletion acknowledgement is independent of a running full sync", async () => {
    const db = await database();
    const factory = new DatabaseProviderFactory();
    factory.setDatabaseManager({ database: db });
    await deleteVideo(db, id, { youtube: true });
    const saved = {
      configuration: credentialStorage.getConfiguration,
      session: credentialStorage.getSession,
      connected: supabaseDatabaseProvider.isConnected,
      upload: supabaseDatabaseProvider.importVideos,
    };
    credentialStorage.getConfiguration = async () => ({ projectId: "fixture" });
    credentialStorage.getSession = async () => ({ userId: "owner" });
    supabaseDatabaseProvider.isConnected = true;
    try {
      supabaseDatabaseProvider.importVideos = async () => {
        throw new Error("Network unavailable");
      };
      try {
        await factory.syncVideoDeletion(id);
        assert(false, "cloud failure swallowed");
      } catch (error) {
        assert(error.message === "Network unavailable", error.message);
      }
      assert((await pendingVideos(db)).length === 1, "failed upload discarded");
      supabaseDatabaseProvider.importVideos = async (rows) => {
        assert(rows.length === 1 && isDeleted(rows[0]), "wrong cloud payload");
        return true;
      };
      assert(
        (await factory.syncVideoDeletion(id)).success,
        "targeted upload failed",
      );
      assert(
        (await pendingVideos(db)).length === 0,
        "cloud acknowledgement missing",
      );
      assert(
        (await factory.youtubeDeletions.pending()).length === 1,
        "cloud cleared YouTube job",
      );
      // General sync may already have acknowledged the same tombstone.
      await deleteVideo(db, id, { youtube: true });
      await acknowledgeVideos(db, await pendingVideos(db));
      assert(
        (await factory.syncVideoDeletion(id)).success,
        "already synced deletion failed",
      );
    } finally {
      credentialStorage.getConfiguration = saved.configuration;
      credentialStorage.getSession = saved.session;
      supabaseDatabaseProvider.isConnected = saved.connected;
      supabaseDatabaseProvider.importVideos = saved.upload;
      db.close();
    }
  });
}

import {
  deleteVideo,
  localPage,
  pendingVideos,
  saveVideos,
  acknowledgeVideos,
} from "../../extension/history/history-storage.js";
import { isDeleted } from "../../extension/history/history-records.js";
import { DatabaseProviderFactory } from "../../extension/providers/database-provider-factory.js";
import { credentialStorage } from "../../extension/providers/credential-storage.js";
import { supabaseDatabaseProvider } from "../../extension/providers/supabase-database-provider.js";

export async function testVideoDeletion({ test, database, assert }) {
  const id = "aaaaaaaaaaa";
  await test("cloud deletion survives reopening IndexedDB", async () => {
    const db = await database();
    await saveVideos(db, [{ strIdent: id, intTimestamp: 100 }]);
    await deleteVideo(db, id);
    const name = db.name;
    db.close();
    const reopened = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    assert(
      isDeleted((await localPage(reopened))[0]),
      "local deletion did not survive",
    );
    assert(
      (await pendingVideos(reopened))[0].video.intDeletedAt > 0,
      "cloud deletion not queued",
    );
    reopened.close();
  });

  await test("cloud deletion acknowledgement is independent of a running full sync", async () => {
    const db = await database();
    const factory = new DatabaseProviderFactory();
    factory.setDatabaseManager({ database: db });
    await deleteVideo(db, id);
    const saved = {
      configuration: credentialStorage.getConfiguration,
      session: credentialStorage.getSession,
      connected: supabaseDatabaseProvider.isConnected,
      upload: supabaseDatabaseProvider.importVideos,
      request: supabaseDatabaseProvider.makeRequest,
    };
    credentialStorage.getConfiguration = async () => ({ projectId: "fixture" });
    const owner = "00000000-0000-4000-8000-000000000001";
    credentialStorage.getSession = async () => ({
      userId: owner,
      historyOwnerId: owner,
    });
    supabaseDatabaseProvider.makeRequest = async () => Response.json(owner);
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
      // General sync may already have acknowledged the same tombstone.
      await deleteVideo(db, id);
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
      supabaseDatabaseProvider.makeRequest = saved.request;
      db.close();
    }
  });
}

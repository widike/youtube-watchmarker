import { supabaseDatabaseProvider } from "./supabase-database-provider.js";
import { credentialStorage } from "./credential-storage.js";
import { IndexedDBProvider } from "./indexeddb-provider.js";
import { HistorySync } from "./provider-sync.js";
import { YouTubeDeletionQueue } from "./youtube-deletion-queue.js";
import { pendingWatchTimeCount } from "./watch-time-replication.js";
import {
  OUTBOX_STORE,
  readMetadata,
  readRequest,
  writeMetadata,
  acknowledgeVideos,
} from "./history-storage.js";

// There is one history store, with automatic authenticated replication.
export class DatabaseProviderFactory {
  setDatabaseManager(manager) {
    this.databaseManager = manager;
    this.indexedDBProvider = new IndexedDBProvider(manager);
    this.sync = new HistorySync(manager.database, supabaseDatabaseProvider);
    this.youtubeDeletions = new YouTubeDeletionQueue(manager.database);
  }

  getCurrentProvider() {
    return this.indexedDBProvider;
  }

  async init() {
    await this.indexedDBProvider.init();
    this.indexedDBProvider.updateConnectionStatus();
    // Import pending records from the replaced queue. Remove it only after
    // the new history + outbox transaction commits.
    const stored = await chrome.storage.local.get(["sync_queue_pending"]);
    for (const entry of stored.sync_queue_pending || []) {
      if (entry.type === "DELETE_VIDEO") {
        const local = await this.indexedDBProvider.getVideo(
          entry.data.strIdent,
        );
        if (!local || local.intTimestamp <= entry.timestamp) {
          await this.indexedDBProvider.deleteVideo(entry.data.strIdent);
        }
        continue;
      }
      const rows =
        entry.type === "PUT_VIDEO"
          ? [entry.data]
          : entry.type === "IMPORT_VIDEOS"
            ? entry.data.videos
            : [];
      await this.indexedDBProvider.importVideos(rows);
    }
    await chrome.storage.local.remove([
      "sync_queue_pending",
      "database_provider",
      "last_delta_sync_timestamp",
    ]);
    return true;
  }

  async assertIdentity(configuration, session) {
    const identity = `${configuration.projectId}:${session.historyOwnerId || session.userId}`;
    const bound = await readMetadata(
      this.databaseManager.database,
      "cloudIdentity",
    );
    if (bound && bound !== identity) {
      throw new Error(
        "This history belongs to a different connection. Use a code from a device connected to the original history.",
      );
    }
    return identity;
  }

  async isConfigured() {
    return credentialStorage.hasAuthenticatedSession();
  }

  async canCreateHistory() {
    return !(await readMetadata(
      this.databaseManager.database,
      "cloudIdentity",
    ));
  }

  async performDeltaSync(options) {
    const [configuration, session] = await Promise.all([
      credentialStorage.getConfiguration(),
      credentialStorage.getSession(),
    ]);
    if (!configuration || !session)
      return {
        success: false,
        error: "Connect to sync your history across devices.",
      };
    const identity = await this.assertIdentity(configuration, session);
    await writeMetadata(
      this.databaseManager.database,
      "cloudIdentity",
      identity,
    );
    return this.sync.sync(options);
  }

  async syncVideoDeletion(videoId) {
    const [configuration, session] = await Promise.all([
      credentialStorage.getConfiguration(),
      credentialStorage.getSession(),
    ]);
    if (!configuration || !session)
      return {
        success: false,
        error: "Connect to Supabase to finish the deletion.",
      };
    const identity = await this.assertIdentity(configuration, session);
    await writeMetadata(
      this.databaseManager.database,
      "cloudIdentity",
      identity,
    );
    const tx = this.databaseManager.database.transaction(
      OUTBOX_STORE,
      "readonly",
    );
    const entry = await readRequest(tx.objectStore(OUTBOX_STORE).get(videoId));
    if (!entry) return { success: true };
    if (!supabaseDatabaseProvider.isConnected)
      await supabaseDatabaseProvider.init();
    if (!(await supabaseDatabaseProvider.importVideos([entry.video])))
      throw new Error("Supabase did not acknowledge the deletion");
    await acknowledgeVideos(this.databaseManager.database, [entry]);
    return { success: true };
  }

  async getProviderStatus() {
    const tx = this.databaseManager.database.transaction(
      OUTBOX_STORE,
      "readonly",
    );
    const pending = await readRequest(tx.objectStore(OUTBOX_STORE).count());
    const youtubeJobs = await this.youtubeDeletions.pending();
    return {
      configured: await credentialStorage.hasAuthenticatedSession(),
      pending:
        pending +
        youtubeJobs.length +
        (await pendingWatchTimeCount(this.databaseManager.database)),
      ...((await readMetadata(this.databaseManager.database, "syncStatus")) ||
        {}),
    };
  }
}

export const databaseProviderFactory = new DatabaseProviderFactory();

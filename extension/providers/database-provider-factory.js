import { supabaseDatabaseProvider } from "./supabase-database-provider.js";
import { credentialStorage } from "./credential-storage.js";
import { IndexedDBProvider } from "./indexeddb-provider.js";
import { HistorySync } from "./provider-sync.js";
import { YouTubeDeletionQueue } from "../sources/youtube-deletion-queue.js";
import { pendingWatchTimeCount } from "../history/watch-time-replication.js";
import { pendingDurationCount } from "../duration/duration-replication.js";
import { DurationStorage } from "../duration/duration-storage.js";
import { resolveCloudIdentity } from "./cloud-identity.js";
import { getBlockedVideoStore } from "../background/blocked-videos.js";
import { BlockedVideoSync } from "../background/blocked-video-sync.js";
import {
  OUTBOX_STORE,
  readMetadata,
  writeMetadata,
  readRequest,
  acknowledgeVideos,
} from "../history/history-storage.js";

// There is one history store, with automatic authenticated replication.
export class DatabaseProviderFactory {
  setDatabaseManager(manager) {
    this.databaseManager = manager;
    this.indexedDBProvider = new IndexedDBProvider(manager);
    this.sync = new HistorySync(
      manager.database,
      supabaseDatabaseProvider,
      Date.now,
      () => new DurationStorage(() => manager.database).notifyCacheChanged(),
    );
    this.youtubeDeletions = new YouTubeDeletionQueue(manager.database);
    this.blockedVideoSync = new BlockedVideoSync(
      getBlockedVideoStore(),
      supabaseDatabaseProvider,
    );
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
    await resolveCloudIdentity(
      this.databaseManager.database,
      configuration,
      session,
      supabaseDatabaseProvider,
    );
    const previous =
      (await readMetadata(this.databaseManager.database, "syncStatus")) || {};
    const [history, blocks] = await Promise.allSettled([
      this.sync.sync(options),
      this.blockedVideoSync.sync(),
    ]);
    const result =
      history.status === "fulfilled"
        ? history.value
        : { success: false, error: history.reason.message };
    const error =
      [
        result.error,
        blocks.status === "rejected"
          ? `Blocked videos: ${blocks.reason.message}`
          : null,
      ]
        .filter(Boolean)
        .join("; ") || null;
    const status = {
      ...((await readMetadata(this.databaseManager.database, "syncStatus")) ||
        {}),
      error,
      inProgress: Boolean(
        result.inProgress ||
          (blocks.status === "fulfilled" && !blocks.value.complete),
      ),
      lastSuccess:
        !error && blocks.status === "fulfilled" && blocks.value.complete
          ? result.lastSuccess
          : previous.lastSuccess || 0,
    };
    await writeMetadata(this.databaseManager.database, "syncStatus", status);
    return { ...result, ...status, success: result.success === true && !error };
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
    await resolveCloudIdentity(
      this.databaseManager.database,
      configuration,
      session,
      supabaseDatabaseProvider,
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
        (await pendingWatchTimeCount(this.databaseManager.database)) +
        (await pendingDurationCount(this.databaseManager.database)) +
        (await getBlockedVideoStore().pendingRecords()).length,
      ...((await readMetadata(this.databaseManager.database, "syncStatus")) ||
        {}),
    };
  }
}

export const databaseProviderFactory = new DatabaseProviderFactory();

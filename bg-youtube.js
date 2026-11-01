import { VideoRecordStore } from "./video-record-store.js";
import { logger } from "./logger.js";
import { synchronizeLikedVideos } from "./youtube-liked-sync.js";
import { synchronizeHistory } from "./youtube-history-sync.js";
import { deleteFromHistoryFirstPage } from "./youtube-history-delete.js";

/**
 * YouTube management class
 * Handles YouTube history sync, liked videos, and video operations
 */
export class YoutubeManager extends VideoRecordStore {
  constructor() {
    super();
    this.isInitialized = false;
    this.providerFactory = null;
  }

  /**
   * Set the provider factory for dependency injection
   * @param {Object} factory - Database provider factory instance
   */
  setProviderFactory(factory) {
    this.providerFactory = factory;
  }

  /**
   * Get the current database provider
   * @returns {Object} Database provider
   * @throws {Error} If provider factory not set
   */
  getProvider() {
    if (!this.providerFactory) {
      throw new Error(
        "Provider factory not set. Call setProviderFactory() first.",
      );
    }
    const provider = this.providerFactory.getCurrentProvider();
    if (!provider) {
      throw new Error("No current database provider available");
    }
    return provider;
  }

  /**
   * Initialize the YouTube module
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    logger.debug("YouTube module initialized");
  }

  // Startup, periodic and manual requests share one import to avoid duplicate writes.
  previewHistory({ signal } = {}) {
    return synchronizeHistory(this, null, { preview: true, signal });
  }

  previewLikedVideos({ signal } = {}) {
    return synchronizeLikedVideos(this, null, { preview: true, signal });
  }

  synchronize(onProgress = null) {
    if (!this.historySyncPromise) {
      this.historySyncPromise = synchronizeHistory(this, onProgress).finally(
        () => {
          this.historySyncPromise = null;
        },
      );
    }
    return this.historySyncPromise;
  }

  synchronizeLikedVideos(onProgress = null) {
    if (!this.likedSyncPromise) {
      this.likedSyncPromise = synchronizeLikedVideos(this, onProgress).finally(
        () => {
          this.likedSyncPromise = null;
        },
      );
    }
    return this.likedSyncPromise;
  }

  async deleteFromHistoryFirstPage(videoId) {
    return deleteFromHistoryFirstPage(videoId);
  }
}

export const Youtube = new YoutubeManager();

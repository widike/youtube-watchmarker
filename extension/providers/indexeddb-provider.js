import { isDeleted } from "../history/history-records.js";
import {
  deleteVideo,
  readRequest,
  saveVideos,
} from "../history/history-storage.js";
import { DATABASE } from "../shared/constants.js";
import { recordPlayback } from "../history/history-playback.js";
import { repairVideoTitle } from "../history/history-title-storage.js";
import { readVideos } from "../history/history-event-storage.js";
// @ts-check

/**
 * IndexedDB Provider
 * Wraps the existing IndexedDB functionality to match the provider interface
 */

/**
 * IndexedDB Provider class
 */
export class IndexedDBProvider {
  constructor(databaseManager) {
    this.databaseManager = databaseManager;
    this.isInitialized = false;
    this.isConnected = false;
  }

  async init() {
    if (!this.databaseManager) {
      throw new Error("Database manager not set");
    }

    // If database is already open, we're good
    if (this.databaseManager.database) {
      this.isInitialized = true;
      this.isConnected = true;
      return true;
    }

    // If database manager exists but database isn't open yet,
    // that's okay - it will be opened during database initialization
    // We just mark as initialized and will connect when database opens
    this.isInitialized = true;
    this.isConnected = false;
    return true;
  }

  async testConnection() {
    // Update connection status based on current database state
    this.isConnected =
      this.databaseManager && this.databaseManager.database !== null;
    return this.isConnected;
  }

  /**
   * Update connection status based on database state
   */
  updateConnectionStatus() {
    // More thorough connection checking
    const isDbOpen = this.databaseManager?.database !== null;
    const isDbInitialized = this.databaseManager?.isInitialized === true;

    // We're connected if database is open AND initialized
    this.isConnected = isDbOpen && isDbInitialized;

    // Log status for debugging
    if (!this.isConnected) {
      console.debug("IndexedDB connection status:", {
        isDbOpen,
        isDbInitialized,
        databaseExists: !!this.databaseManager?.database,
        managerInitialized: !!this.databaseManager?.isInitialized,
      });
    }
  }

  async getVideo(videoId, { includeDeleted = false } = {}) {
    // Update connection status
    this.updateConnectionStatus();

    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    const video = await readVideos(this.databaseManager.database, {
      id: videoId,
    });
    return !includeDeleted && isDeleted(video) ? null : video;
  }

  async putVideo(video) {
    // Update connection status
    this.updateConnectionStatus();

    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    return saveVideos(this.databaseManager.database, [video], {
      source: true,
    });
  }

  async recordPlayback(videoId, title, playbackId) {
    this.updateConnectionStatus();
    if (!this.isConnected) throw new Error("Database not connected");
    return recordPlayback(
      this.databaseManager.database,
      videoId,
      title,
      playbackId,
    );
  }

  async repairVideoTitle(videoId, title) {
    this.updateConnectionStatus();
    if (!this.isConnected) throw new Error("Database not connected");
    return repairVideoTitle(this.databaseManager.database, videoId, title);
  }

  async getAllVideos({ includeDeleted = false } = {}) {
    // Update connection status
    this.updateConnectionStatus();

    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    const videos = await readVideos(this.databaseManager.database);
    return videos.filter((video) => includeDeleted || !isDeleted(video));
  }

  async getVideoCount() {
    this.updateConnectionStatus();
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    const tx = this.databaseManager.database.transaction(
      DATABASE.STORE_NAME,
      "readonly",
    );
    const summaries = await readRequest(
      tx.objectStore(DATABASE.STORE_NAME).getAll(),
    );
    return summaries.filter((video) => !isDeleted(video)).length;
  }

  async clearAllVideos() {
    throw new Error(
      "History is retained. Export a backup instead of resetting it.",
    );
  }

  async deleteVideo(videoId, options) {
    return deleteVideo(this.databaseManager.database, videoId, options);
  }

  async importVideos(videos) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    if (!videos || videos.length === 0) {
      return true;
    }

    return saveVideos(this.databaseManager.database, videos);
  }

  async searchVideos(query, limit = 100) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    const allVideos = await this.getAllVideos();
    const filteredVideos = allVideos.filter(
      (video) =>
        video.strTitle &&
        video.strTitle.toLowerCase().includes(query.toLowerCase()),
    );

    return filteredVideos.slice(0, limit);
  }

  async getVideosByDateRange(startTimestamp, endTimestamp) {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    const allVideos = await this.getAllVideos();
    return allVideos.filter(
      (video) =>
        video.intTimestamp >= startTimestamp &&
        video.intTimestamp <= endTimestamp,
    );
  }

  async getStatistics() {
    if (!this.isConnected) {
      throw new Error("Database not connected");
    }

    const allVideos = await this.getAllVideos();

    if (allVideos.length === 0) {
      return {
        totalVideos: 0,
        oldestTimestamp: 0,
        newestTimestamp: 0,
        totalViews: 0,
        avgViewsPerVideo: 0,
      };
    }

    const timestamps = allVideos.map((v) => v.intTimestamp).filter((t) => t);
    const totalViews = allVideos.reduce((sum, v) => sum + (v.intCount || 1), 0);

    return {
      totalVideos: allVideos.length,
      oldestTimestamp: Math.min(...timestamps),
      newestTimestamp: Math.max(...timestamps),
      totalViews,
      avgViewsPerVideo: totalViews / allVideos.length,
    };
  }

  async close() {
    this.isConnected = false;
    return true;
  }

  getProviderInfo() {
    return {
      name: "IndexedDB",
      type: "local",
      isConnected: this.isConnected,
      isInitialized: this.isInitialized,
    };
  }
}

import { logger } from "./logger.js";
import { queryHistory } from "./history-query.js";
import { historyEntries } from "./history-events.js";
import { videoTitleRecovery } from "./video-title-recovery.js";
import { isValidVideoId } from "./validation.js";

/**
 * Search management class
 * Handles video search and deletion operations
 */
export class SearchManager {
  constructor() {
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
   * Initialize the Search module
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    logger.debug("Search module initialized");
  }

  /**
   * Search for videos in the database
   * @param {string} [query=''] - Search query (searches in ID and title)
   * @param {number} [skip=0] - Number of results to skip
   * @param {number} [length=0] - Number of results to return (0 = all)
   * @returns {Promise<Object>} Object with videos array and totalResults count
   */
  async lookup(query = "", skip = 0, length = 0, options = {}) {
    try {
      const currentProvider = this.getProvider();

      // Get all videos from the current provider
      const allVideos = await currentProvider.getAllVideos();
      await videoTitleRecovery.repair(currentProvider, allVideos);

      const filteredVideos = queryHistory(historyEntries(allVideos), {
        ...options,
        query,
      });

      // Count matches across the complete library.
      const totalResults = filteredVideos.length;

      // Return only the requested batch.
      const actualLength = length || filteredVideos.length;
      const paginatedVideos = filteredVideos.slice(skip, skip + actualLength);

      return {
        videos: paginatedVideos,
        totalResults: totalResults,
      };
    } catch (error) {
      logger.error("Search lookup error:", error);
      throw error;
    }
  }

  // Only the trash action reaches this method. A missing remote record never
  // implies deletion. The durable tombstone is retried like every other write.
  async delete(videoId) {
    if (!isValidVideoId(videoId)) throw new Error("Invalid video ID");
    await this.getProvider().deleteVideo(videoId, { youtube: true });
    const operations = await Promise.allSettled([
      this.providerFactory.syncVideoDeletion(videoId),
      this.providerFactory.youtubeDeletions.process(videoId),
    ]);
    const pending = operations.flatMap((result, index) => {
      const service = index === 0 ? "Supabase" : "YouTube";
      if (result.status === "rejected")
        return [`${service}: ${result.reason.message}`];
      return result.value?.success
        ? []
        : [`${service}: ${result.value?.error || "Deletion pending"}`];
    });
    return {
      deleted: true,
      success: pending.length === 0,
      ...(pending.length
        ? {
            error: `Deleted locally. Pending deletion will retry automatically. ${pending.join("; ")}`,
          }
        : {}),
    };
  }
}

export const Search = new SearchManager();

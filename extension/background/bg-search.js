import { logger } from "../shared/logger.js";
import { queryHistory } from "../history/history-query.js";
import { historyEntries } from "../history/history-events.js";
import { videoTitleRecovery } from "../shared/video-title-recovery.js";
import { isValidVideoId } from "../shared/validation.js";

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
   * @param {string} [query=''] - Terms to match in the video title
   * @param {number} [skip=0] - Number of results to skip
   * @param {number} [length=0] - Number of results to return (0 = all)
   * @returns {Promise<Object>} Object with videos array and totalResults count
   */
  async lookup(query = "", skip = 0, length = 0, options = {}) {
    try {
      const currentProvider = this.getProvider();

      const revision = currentProvider.historyRevision;
      const today = new Date().setHours(0, 0, 0, 0);
      const key = JSON.stringify([
        query,
        options.wordGroup,
        options.period,
        options.sort,
        today,
      ]);
      const cached = this.search;
      let filteredVideos;
      if (
        cached?.provider === currentProvider &&
        cached.revision === revision &&
        cached.key === key
      ) {
        filteredVideos = cached.videos;
      } else {
        const allVideos = await currentProvider.getAllVideos();
        await videoTitleRecovery.repair(currentProvider, allVideos);
        filteredVideos = queryHistory(historyEntries(allVideos), {
          ...options,
          query,
        });
        this.search = {
          provider: currentProvider,
          revision,
          key,
          videos: filteredVideos,
        };
      }

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
    await this.getProvider().deleteVideo(videoId);
    try {
      if (!(await this.providerFactory.isConfigured()))
        return { deleted: true, success: true };
      const result = await this.providerFactory.syncVideoDeletion(videoId);
      if (!result.success) throw new Error(result.error);
      return { deleted: true, success: true };
    } catch (error) {
      return {
        deleted: true,
        success: false,
        error: `Deleted locally. Supabase will retry automatically: ${error.message}`,
      };
    }
  }
}

export const Search = new SearchManager();

import { logger } from "./logger.js";
import { YOUTUBE } from "./constants.js";

/**
 * Search management class
 * Handles video search and deletion operations
 */
export class SearchManager {
    constructor() {
        this.isInitialized = false;
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
        logger.debug('Search module initialized');
    }

    /**
     * Get the current database provider
     * @returns {Object} Database provider
     * @throws {Error} If provider is not available
     */
    getProvider() {
        const extensionManager = globalThis.extensionManager;
        if (!extensionManager || !extensionManager.providerFactory) {
            throw new Error("Database provider factory not available");
        }

        const currentProvider = extensionManager.providerFactory.getCurrentProvider();
        if (!currentProvider) {
            throw new Error("No current database provider available");
        }

        return currentProvider;
    }

    /**
     * Search for videos in the database
     * @param {string} [query=''] - Search query (searches in ID and title)
     * @param {number} [skip=0] - Number of results to skip
     * @param {number} [length=0] - Number of results to return (0 = all)
     * @returns {Promise<Object>} Object with videos array and totalResults count
     */
    async lookup(query = '', skip = 0, length = 0) {
        try {
            const currentProvider = this.getProvider();

            // Get all videos from the current provider
            const allVideos = await currentProvider.getAllVideos();

            // Filter videos based on search query
            let filteredVideos = [];

            if (!query || query.trim() === '') {
                // Empty query - show all videos
                filteredVideos = allVideos;
            } else {
                // Non-empty query - search in both ID and title (case-insensitive)
                const searchTerm = query.toLowerCase().trim();
                filteredVideos = allVideos.filter(video => {
                    const videoId = (video.strIdent || '').toLowerCase();
                    const videoTitle = (video.strTitle || '').toLowerCase();
                    return videoId.includes(searchTerm) || videoTitle.includes(searchTerm);
                });
            }

            // Sort by timestamp (newest first)
            filteredVideos.sort((a, b) => (b.intTimestamp || 0) - (a.intTimestamp || 0));

            // Store total count before pagination
            const totalResults = filteredVideos.length;

            // Apply pagination
            const actualLength = length || filteredVideos.length;
            const paginatedVideos = filteredVideos.slice(skip, skip + actualLength);

            return {
                videos: paginatedVideos,
                totalResults: totalResults
            };

        } catch (error) {
            logger.error("Search lookup error:", error);
            throw error;
        }
    }

    /**
     * Delete a video from database and browser history
     * @param {string} videoId - Video ID to delete
     * @param {Function} [onProgress] - Optional progress callback
     * @returns {Promise<boolean>} Success status
     */
    async delete(videoId, onProgress = null) {
        try {
            const currentProvider = this.getProvider();

            // Step 1: Delete from database
            if (onProgress) {
                onProgress({
                    strProgress: "1/2 - deleting it from the database",
                });
            }

            await currentProvider.deleteVideo(videoId);

            // Step 2: Delete from browser history
            if (onProgress) {
                onProgress({
                    strProgress: "2/2 - deleting it from the history in the browser",
                });
            }

            // Search for YouTube URLs containing this video ID
            const historyResults = await new Promise((resolve) => {
                chrome.history.search({
                    text: videoId,
                    startTime: 0,
                    maxResults: 1000000,
                },
                    resolve
                );
            });

            // Delete matching URLs from browser history
            for (let historyResult of historyResults) {
                // Check if URL is a valid YouTube video URL
                if (
                    !historyResult.url.startsWith(YOUTUBE.URLS.WATCH) &&
                    !historyResult.url.startsWith(YOUTUBE.URLS.SHORTS) &&
                    !historyResult.url.startsWith(YOUTUBE.URLS.MOBILE_WATCH)
                ) {
                    continue;
                }

                if (!historyResult.title) {
                    continue;
                }

                chrome.history.deleteUrl({
                    url: historyResult.url,
                });
            }

            logger.info(`Deleted video ${videoId} from database and history`);
            return true;

        } catch (error) {
            logger.error("Search delete error:", error);
            throw error;
        }
    }
}

// Global instance
export const Search = new SearchManager();

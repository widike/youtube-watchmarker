import { decodeHtmlEntitiesAndFixEncoding } from "./text-utils.js";
import { logger } from "./logger.js";
import { YOUTUBE } from "./constants.js";

/**
 * History management class
 * Handles browser history synchronization with YouTube videos
 */
export class HistoryManager {
    constructor() {
        this.isInitialized = false;
    }

    /**
     * Initialize the History module
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;
        logger.debug('History module initialized');
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
     * Extract video ID from YouTube URL
     * @param {string} url - YouTube URL
     * @returns {string|null} Video ID or null if invalid
     */
    extractVideoId(url) {
        if (url.startsWith(YOUTUBE.URLS.WATCH) || url.startsWith(YOUTUBE.URLS.MOBILE_WATCH)) {
            // For regular YouTube URLs: https://www.youtube.com/watch?v=VIDEO_ID&other=params
            try {
                const urlParams = new URL(url).searchParams;
                return urlParams.get('v');
            } catch {
                logger.warn("Failed to parse URL:", url);
                return null;
            }
        } else if (url.startsWith(YOUTUBE.URLS.SHORTS)) {
            // For YouTube Shorts: https://www.youtube.com/shorts/VIDEO_ID?t=33
            const shortsPath = url.replace(YOUTUBE.URLS.SHORTS, "");
            return shortsPath.split('?')[0]; // Remove any query parameters
        }

        return null;
    }

    /**
     * Validate if URL is a valid YouTube video URL
     * @param {string} url - URL to validate
     * @returns {boolean} True if valid YouTube video URL
     */
    isYouTubeVideoUrl(url) {
        return url.startsWith(YOUTUBE.URLS.WATCH) ||
            url.startsWith(YOUTUBE.URLS.SHORTS) ||
            url.startsWith(YOUTUBE.URLS.MOBILE_WATCH);
    }

    /**
     * Clean YouTube title by removing suffix
     * @param {string} title - Original title
     * @returns {string} Cleaned title
     */
    cleanTitle(title) {
        let cleanTitle = title;
        if (cleanTitle.endsWith(YOUTUBE.PATTERNS.TITLE_SUFFIX)) {
            cleanTitle = cleanTitle.slice(0, -YOUTUBE.PATTERNS.TITLE_SUFFIX.length);
        }

        // Fix UTF-8 double encoding issues
        cleanTitle = decodeHtmlEntitiesAndFixEncoding(cleanTitle);

        return cleanTitle;
    }

    /**
     * Synchronize browser history with YouTube videos
     * @param {number} startTime - Start timestamp (milliseconds)
     * @param {boolean} [skipExisting=false] - Skip videos already in database
     * @param {Function} [onProgress] - Optional progress callback
     * @returns {Promise<Object>} Synchronization result
     */
    async synchronize(startTime = 0, skipExisting = false, onProgress = null) {
        try {
            // Validate parameters
            if (typeof startTime !== 'number') {
                throw new Error("Invalid startTime - must be a number");
            }

            const currentProvider = this.getProvider();

            // Search Chrome history for YouTube videos
            const historyResults = await new Promise((resolve, reject) => {
                chrome.history.search({
                    text: "youtube.com",
                    startTime: startTime,
                    maxResults: 1000000,
                },
                    function (objResults) {
                        if (chrome.runtime.lastError) {
                            logger.error("Chrome history search error:", chrome.runtime.lastError);
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }

                        if (!objResults) {
                            logger.error("No results returned from history search");
                            reject(new Error("No results returned"));
                            return;
                        }

                        resolve(objResults);
                    });
            });

            let processedVideos = [];
            let processedCount = 0;
            let skippedCount = 0;

            for (let historyResult of historyResults) {
                // Check if URL is a YouTube video URL
                if (!this.isYouTubeVideoUrl(historyResult.url)) {
                    skippedCount++;
                    continue;
                }

                // Check if title exists
                if (!historyResult.title || historyResult.title.trim() === "") {
                    skippedCount++;
                    continue;
                }

                // Clean up YouTube title
                const cleanTitle = this.cleanTitle(historyResult.title);

                // Extract video ID from URL
                const videoId = this.extractVideoId(historyResult.url);

                // Validate video ID format (11 characters, alphanumeric and dashes/underscores)
                if (!videoId || !YOUTUBE.PATTERNS.VIDEO_ID.test(videoId)) {
                    logger.warn("Invalid video ID format:", videoId, "from URL:", historyResult.url);
                    skippedCount++;
                    continue;
                }

                // Check if video already exists in the database
                const existingVideo = await currentProvider.getVideo(videoId);

                // If skipExisting is true and video exists, skip it
                if (skipExisting && existingVideo) {
                    skippedCount++;
                    continue;
                }

                let videoToStore;
                if (existingVideo) {
                    // Update existing video with latest timestamp and count
                    videoToStore = {
                        strIdent: videoId,
                        intTimestamp: Math.max(existingVideo.intTimestamp || 0, historyResult.lastVisitTime || 0),
                        strTitle: existingVideo.strTitle || cleanTitle,
                        intCount: Math.max(existingVideo.intCount || 1, historyResult.visitCount || 1),
                    };
                } else {
                    // Create new video record
                    videoToStore = {
                        strIdent: videoId,
                        intTimestamp: historyResult.lastVisitTime,
                        strTitle: cleanTitle,
                        intCount: historyResult.visitCount || 1,
                    };
                }

                // Store the video in the current provider
                await currentProvider.putVideo(videoToStore);
                processedVideos.push(videoToStore);
                processedCount++;

                // Report progress every 100 videos
                if (processedCount % 100 === 0 && onProgress) {
                    onProgress({
                        strProgress: `imported ${processedCount} videos`,
                    });
                }
            }

            // Return results
            const result = {
                objVideos: processedVideos,
                videoCount: processedCount,
                skippedCount: skippedCount
            };

            logger.info(`History sync completed: ${processedCount} videos processed, ${skippedCount} skipped`);
            return result;

        } catch (error) {
            logger.error("History synchronization error:", error);
            throw error;
        }
    }
}

// Global instance
export const History = new HistoryManager();

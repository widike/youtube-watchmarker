import { isValidVideoTitle, VIDEO_ID_LENGTH } from "./validation.js";
import { TIMEOUTS } from "./constants.js";
import { logger } from "./logger.js";
import { parseHistoryPage, parseLikedVideosPage } from "./youtube-parser.js";

/**
 * YouTube management class
 * Handles YouTube history sync, liked videos, and video operations
 */
export class YoutubeManager {
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
            throw new Error('Provider factory not set. Call setProviderFactory() first.');
        }
        const provider = this.providerFactory.getCurrentProvider();
        if (!provider) {
            throw new Error('No current database provider available');
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
        logger.debug('YouTube module initialized');
    }

    /**
     * Synchronize YouTube watch history
     * @param {Function} [onProgress] - Optional progress callback
     * @returns {Promise<Object>} Synchronization result
     */
    async synchronize(onProgress = null) {
        try {
            const currentProvider = this.getProvider();
            logger.info("Starting YouTube history sync (single page only)...");

            // Fetch YouTube history page
            const response = await fetch("https://www.youtube.com/feed/history");

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const responseText = await response.text();

            // Use parser to extract videos from the page
            const objVideos = parseHistoryPage(responseText);

            // Store videos in the current provider
            let processedCount = 0;
            let skippedCount = 0;

            for (const video of objVideos) {
                try {
                    // Check if video already exists
                    const existingVideo = await currentProvider.getVideo(video.strIdent);

                    if (existingVideo) {
                        skippedCount++;
                        continue;
                    }

                    // Store new video
                    await currentProvider.putVideo(video);
                    processedCount++;

                    // Report progress every 10 videos
                    if (processedCount % 10 === 0 && onProgress) {
                        onProgress({
                            strProgress: `processed ${processedCount} YouTube videos`,
                        });
                    }
                } catch (error) {
                    logger.error(`Error storing video ${video.strIdent}:`, error);
                }
            }

            // Return results
            const result = {
                objVideos: objVideos,
                videoCount: processedCount,
                updatedCount: 0,
                newCount: processedCount,
                skippedCount: skippedCount
            };

            logger.info(`YouTube sync completed: Found ${objVideos.length} total videos, ${processedCount} new added, ${skippedCount} already in database`);
            return result;

        } catch (error) {
            logger.error("YouTube synchronization error:", error);
            throw error;
        }
    }

    /**
     * Synchronize YouTube liked videos
     * @param {Function} [onProgress] - Optional progress callback
     * @returns {Promise<Object>} Synchronization result
     */
    async synchronizeLikedVideos(onProgress = null) {
        try {
            const currentProvider = this.getProvider();
            logger.info("Starting YouTube liked videos sync (single page only)...");

            // Fetch YouTube liked videos page
            const response = await fetch("https://www.youtube.com/playlist?list=LL");

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const responseText = await response.text();

            // Use parser to extract videos from the page
            const objVideos = parseLikedVideosPage(responseText);

            // Store videos in the current provider
            let processedCount = 0;
            let skippedCount = 0;

            for (const video of objVideos) {
                try {
                    // Check if video already exists
                    const existingVideo = await currentProvider.getVideo(video.strIdent);

                    if (existingVideo) {
                        skippedCount++;
                        continue;
                    }

                    // Store new video
                    await currentProvider.putVideo(video);
                    processedCount++;

                    // Report progress every 10 videos
                    if (processedCount % 10 === 0 && onProgress) {
                        onProgress({
                            strProgress: `processed ${processedCount} liked videos`,
                        });
                    }
                } catch (error) {
                    logger.error(`Error storing video ${video.strIdent}:`, error);
                }
            }

            // Return results
            const result = {
                objVideos: objVideos,
                videoCount: processedCount,
                newCount: processedCount,
                skippedCount: skippedCount
            };

            logger.info(`Liked videos sync completed: Found ${objVideos.length} total videos, ${processedCount} new added, ${skippedCount} already in database`);
            return result;

        } catch (error) {
            logger.error("Liked videos synchronization error:", error);
            throw error;
        }
    }

    /**
     * Look up a video in the database
     * @param {string} videoId - Video ID to look up
     * @returns {Promise<Object|null>} Video object or null if not found
     */
    async lookup(videoId) {
        try {
            // Validate video ID
            if (!videoId || typeof videoId !== 'string' || videoId.length !== VIDEO_ID_LENGTH) {
                const received = videoId === null ? 'null' : videoId === undefined ? 'undefined' :
                    `${typeof videoId} (${JSON.stringify(videoId).slice(0, 50)})`;
                throw new Error(`Invalid video ID: expected 11-char string, got ${received}`);
            }

            const currentProvider = this.getProvider();

            // Get the specific video from the current provider
            const video = await currentProvider.getVideo(videoId);

            if (video) {
                return {
                    strIdent: video.strIdent,
                    intTimestamp: video.intTimestamp || Date.now(),
                    strTitle: video.strTitle || "",
                    intCount: video.intCount || 1,
                };
            }

            return null;

        } catch (error) {
            logger.error("YouTube lookup error:", error);
            throw error;
        }
    }

    /**
     * Ensure a video exists in the database
     * @param {string} videoId - Video ID
     * @param {string} [title] - Video title
     * @param {number} [timestamp] - Timestamp
     * @param {number} [count] - View count
     * @returns {Promise<Object>} Video object
     */
    async ensure(videoId, title = "", timestamp = null, count = null) {
        try {
            // Validate video ID
            if (!videoId || typeof videoId !== 'string' || videoId.length !== VIDEO_ID_LENGTH) {
                const received = videoId === null ? 'null' : videoId === undefined ? 'undefined' :
                    `${typeof videoId} (${JSON.stringify(videoId).slice(0, 50)})`;
                throw new Error(`Invalid video ID: expected 11-char string, got ${received}`);
            }

            const currentProvider = this.getProvider();

            // Check if video already exists in the database
            const existingVideo = await currentProvider.getVideo(videoId);

            let videoToReturn;
            if (existingVideo) {
                // Prefer valid titles when updating existing videos
                let titleToUse = existingVideo.strTitle || "";
                if (title && isValidVideoTitle(title)) {
                    titleToUse = title;
                } else if (!isValidVideoTitle(titleToUse) && title) {
                    // If existing title is invalid but new title exists, use new title
                    titleToUse = title;
                }

                // Return existing video data with potentially updated title
                logger.debug("Returning existing video data for:", videoId);
                videoToReturn = {
                    strIdent: existingVideo.strIdent,
                    intTimestamp: existingVideo.intTimestamp,
                    strTitle: titleToUse,
                    intCount: existingVideo.intCount || 1,
                };

                // Update the database if title changed
                if (titleToUse !== existingVideo.strTitle) {
                    await currentProvider.putVideo(videoToReturn);
                }
            } else {
                // Create new video entry only with valid titles
                const titleToUse = title && isValidVideoTitle(title) ? title : "";

                logger.debug("Creating new video entry for:", videoId);
                const newVideo = {
                    strIdent: videoId,
                    intTimestamp: timestamp || Date.now(),
                    strTitle: titleToUse,
                    intCount: count || 1,
                };

                // Store the new video in the current provider
                await currentProvider.putVideo(newVideo);
                videoToReturn = newVideo;
            }

            return videoToReturn;

        } catch (error) {
            logger.error("YouTube ensure error:", error);
            throw error;
        }
    }

    /**
     * Mark a video as watched
     * @param {string} videoId - Video ID
     * @param {string} [title] - Video title
     * @param {number} [timestamp] - Timestamp
     * @param {number} [count] - View count
     * @returns {Promise<Object>} Video object
     */
    async mark(videoId, title = "", timestamp = null, count = null) {
        try {
            // Validate video ID
            if (!videoId || typeof videoId !== 'string' || videoId.length !== VIDEO_ID_LENGTH) {
                const received = videoId === null ? 'null' : videoId === undefined ? 'undefined' :
                    `${typeof videoId} (${JSON.stringify(videoId).slice(0, 50)})`;
                throw new Error(`Invalid video ID: expected 11-char string, got ${received}`);
            }

            const currentProvider = this.getProvider();

            // Check if video already exists in the database
            const existingVideo = await currentProvider.getVideo(videoId);
            const currentTime = Date.now();

            let videoToStore;
            if (existingVideo) {
                // Update existing video
                const existingTimestamp = existingVideo.intTimestamp || 0;
                const timeSinceLastView = currentTime - existingTimestamp;

                // Only increment count if enough time has passed since last view
                const shouldIncrementCount = timeSinceLastView >= TIMEOUTS.VIEW_COUNT_COOLDOWN;

                // Prefer valid titles over invalid ones
                let titleToUse = existingVideo.strTitle || "";
                if (title && isValidVideoTitle(title)) {
                    titleToUse = title;
                } else if (!isValidVideoTitle(titleToUse) && title) {
                    // If existing title is invalid but new title exists, use new title even if not ideal
                    titleToUse = title;
                }

                videoToStore = {
                    strIdent: existingVideo.strIdent,
                    intTimestamp: timestamp || currentTime,
                    strTitle: titleToUse,
                    intCount: shouldIncrementCount ? (existingVideo.intCount + 1 || 1) : (existingVideo.intCount || 1),
                };
            } else {
                // Create new video entry only if title is valid or no title is provided
                const titleToUse = title && isValidVideoTitle(title) ? title : "";

                videoToStore = {
                    strIdent: videoId,
                    intTimestamp: timestamp || currentTime,
                    strTitle: titleToUse,
                    intCount: count || 1,
                };
            }

            // Store the video in the current provider
            await currentProvider.putVideo(videoToStore);

            return videoToStore;

        } catch (error) {
            logger.error("YouTube mark error:", error);
            throw error;
        }
    }
}

// Global instance
export const Youtube = new YoutubeManager();

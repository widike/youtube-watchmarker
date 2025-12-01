import { decodeHtmlEntitiesAndFixEncoding } from "./text-utils.js";
import { isValidVideoTitle } from "./validation.js";
import { TIMEOUTS } from "./constants.js";
import { logger } from "./logger.js";

/**
 * YouTube management class
 * Handles YouTube history sync, liked videos, and video operations
 */
export class YoutubeManager {
    constructor() {
        this.isInitialized = false;
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
     * Helper function to safely extract nested property
     * @param {Object} obj - Source object
     * @param {string} path - Dot-separated path
     * @returns {*} Value at path or null
     */
    getNestedProperty(obj, path) {
        return path.split('.').reduce((current, key) => {
            return current && current[key] !== undefined ? current[key] : null;
        }, obj);
    }

    /**
     * Extract video title from various YouTube data structures
     * @param {Object} videoRenderer - Video renderer object
     * @returns {string|null} Extracted title or null
     */
    extractVideoTitle(videoRenderer) {
        const titlePaths = [
            'title.runs.0.text',
            'title.simpleText',
            'title.text',
            'headline.runs.0.text',
            'headline.simpleText',
            'longBylineText.runs.0.text',
            'shortBylineText.runs.0.text',
            'accessibility.accessibilityData.label'
        ];

        for (const path of titlePaths) {
            const title = this.getNestedProperty(videoRenderer, path);
            if (title && typeof title === 'string' && title.trim()) {
                let cleanTitle = title.trim();
                cleanTitle = cleanTitle.replace(/\s+by\s+[^,]*$/i, '').trim();
                cleanTitle = cleanTitle.replace(/\s*-\s*YouTube\s*$/i, '').trim();
                return cleanTitle;
            }
        }

        return null;
    }

    /**
     * Extract videos from YouTube contents array
     * @param {Array} contents - Contents array from YouTube data
     * @returns {Array} Array of video objects
     */
    extractVideosFromContents(contents) {
        const videos = [];
        if (contents && Array.isArray(contents)) {
            for (const section of contents) {
                const items = this.getNestedProperty(section, 'itemSectionRenderer.contents');
                if (items && Array.isArray(items)) {
                    for (const item of items) {
                        // Try lockupViewModel format first (new format)
                        const lockupViewModel = item.lockupViewModel;
                        if (lockupViewModel) {
                            const contentId = lockupViewModel.contentId;
                            const metadata = lockupViewModel.metadata?.lockupMetadataViewModel;
                            const title = metadata?.title?.content || metadata?.title?.text;

                            if (contentId && contentId.length === 11 && title) {
                                videos.push({
                                    strIdent: contentId,
                                    intTimestamp: Date.now(),
                                    strTitle: decodeHtmlEntitiesAndFixEncoding(title),
                                    intCount: 1,
                                });
                                continue;
                            }
                        }

                        // Fallback to videoRenderer format (old format)
                        const videoRenderer = item.videoRenderer;
                        if (videoRenderer && videoRenderer.videoId) {
                            const videoId = videoRenderer.videoId;
                            const title = this.extractVideoTitle(videoRenderer);

                            if (videoId && videoId.length === 11 && title) {
                                videos.push({
                                    strIdent: videoId,
                                    intTimestamp: Date.now(),
                                    strTitle: decodeHtmlEntitiesAndFixEncoding(title),
                                    intCount: 1,
                                });
                            }
                        }
                    }
                }
            }
        }
        return videos;
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

            let objVideos = [];

            // Fetch YouTube history page
            const response = await fetch("https://www.youtube.com/feed/history");

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const responseText = await response.text();
            const cleanedText = responseText
                .replaceAll('\\"', '\\u0022')
                .replaceAll("\r", "")
                .replaceAll("\n", "");

            try {
                // Try to find and parse the main data structure
                const dataRegex = /var\s+ytInitialData\s*=\s*({.+?});/s;
                const dataMatch = responseText.match(dataRegex);

                if (dataMatch) {
                    try {
                        const ytInitialData = JSON.parse(dataMatch[1]);

                        // Navigate through the YouTube data structure
                        const contents = this.getNestedProperty(ytInitialData, 'contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents');

                        // Extract videos from first page
                        const pageVideos = this.extractVideosFromContents(contents);
                        objVideos.push(...pageVideos);
                    } catch (jsonError) {
                        logger.warn("Failed to parse ytInitialData:", jsonError);
                    }
                }

                // Fallback: Parse new yt-lockup-view-model format from HTML
                if (objVideos.length === 0) {
                    const lockupRegex = /<yt-lockup-view-model[^>]*>[\s\S]*?content-id-([a-zA-Z0-9_-]{11})[\s\S]*?<\/yt-lockup-view-model>/g;
                    let lockupMatch;

                    while ((lockupMatch = lockupRegex.exec(responseText)) !== null) {
                        try {
                            const videoId = lockupMatch[1];
                            const lockupHtml = lockupMatch[0];

                            // Extract title from the link text
                            const titleMatch = lockupHtml.match(/<span class="yt-core-attributed-string[^"]*"[^>]*>([^<]+)<\/span>/);
                            let title = titleMatch ? titleMatch[1] : null;

                            // Try alternative title extraction
                            if (!title) {
                                const altTitleMatch = lockupHtml.match(/title="([^"]+)"/);
                                title = altTitleMatch ? altTitleMatch[1] : null;
                            }

                            if (title && !objVideos.some(video => video.strIdent === videoId)) {
                                objVideos.push({
                                    strIdent: videoId,
                                    intTimestamp: Date.now(),
                                    strTitle: decodeHtmlEntitiesAndFixEncoding(title),
                                    intCount: 1,
                                });
                            }
                        } catch (error) {
                            logger.warn("Error parsing yt-lockup-view-model:", error);
                        }
                    }
                }

                // Fallback: Use regex for old videoRenderer format
                if (objVideos.length === 0) {
                    const videoRendererRegex = /"videoRenderer":\s*({[^}]*"videoId"[^}]*})/g;
                    let rendererMatch;

                    while ((rendererMatch = videoRendererRegex.exec(cleanedText)) !== null) {
                        try {
                            const rendererStr = rendererMatch[1];

                            // Extract video ID
                            const videoIdMatch = rendererStr.match(/"videoId":\s*"([^"]{11})"/);
                            if (!videoIdMatch) continue;

                            const videoId = videoIdMatch[1];

                            // Extract title using multiple patterns
                            const titlePatterns = [
                                /"title":\s*{\s*"runs":\s*\[{\s*"text":\s*"([^"]+)"/,
                                /"title":\s*{\s*"simpleText":\s*"([^"]+)"/,
                                /"text":\s*"([^"]+)"/
                            ];

                            let title = null;
                            for (const pattern of titlePatterns) {
                                const titleMatch = rendererStr.match(pattern);
                                if (titleMatch && titleMatch[1]) {
                                    title = titleMatch[1];
                                    break;
                                }
                            }

                            if (title && !objVideos.some(video => video.strIdent === videoId)) {
                                objVideos.push({
                                    strIdent: videoId,
                                    intTimestamp: Date.now(),
                                    strTitle: decodeHtmlEntitiesAndFixEncoding(title),
                                    intCount: 1,
                                });
                            }
                        } catch (error) {
                            logger.warn("Error parsing video renderer:", error);
                        }
                    }
                }
            } catch (error) {
                logger.error("Error in YouTube history parsing:", error);
            }

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
            const cleanedText = responseText
                .replaceAll('\\"', '\\u0022')
                .replaceAll("\r", "")
                .replaceAll("\n", "");

            let objVideos = [];

            try {
                // Extract liked videos with detailed regex (with date)
                const objVideoWithDate = new RegExp(
                    '"playlistVideoRenderer":[^"]*"videoId":[^"]*"([^"]{11})"' + // videoId
                    '.*?"title":[^"]*"runs":[^"]*"text":[^"]*"([^"]*)"' + // title
                    '.*?"videoSecondaryInfoRenderer".*?"dateText":[^"]*"simpleText":[^"]*"([^"]*)"', // dateAdded
                    "g"
                );

                let objMatch;
                while ((objMatch = objVideoWithDate.exec(cleanedText)) !== null) {
                    if (objMatch[1] && objMatch[2]) {
                        objVideos.push({
                            strIdent: objMatch[1],
                            intTimestamp: Date.now(),
                            strTitle: decodeHtmlEntitiesAndFixEncoding(objMatch[2]),
                            intCount: 1,
                        });
                    }
                }

                // Fallback: Simpler pattern without date
                if (objVideos.length === 0) {
                    const objVideoSimple = new RegExp(
                        '"playlistVideoRenderer":[^"]*"videoId":[^"]*"([^"]{11})"' + // videoId
                        '.*?"title":[^"]*"runs":[^"]*"text":[^"]*"([^"]*)"', // title
                        "g"
                    );

                    while ((objMatch = objVideoSimple.exec(cleanedText)) !== null) {
                        if (objMatch[1] && objMatch[2]) {
                            objVideos.push({
                                strIdent: objMatch[1],
                                intTimestamp: Date.now(),
                                strTitle: decodeHtmlEntitiesAndFixEncoding(objMatch[2]),
                                intCount: 1,
                            });
                        }
                    }
                }
            } catch (error) {
                logger.error("Error in liked videos parsing:", error);
            }

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
            if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) {
                throw new Error(`Invalid video ID: ${videoId}`);
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
            if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) {
                throw new Error(`Invalid video ID: ${videoId}`);
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
            if (!videoId || typeof videoId !== 'string' || videoId.length !== 11) {
                throw new Error(`Invalid video ID: ${videoId}`);
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

// @ts-check

/**
 * Video Tracker
 * Handles tracking video views from tabs and requests
 */

import { logger } from './logger.js';
import { sendMessageToTab } from './browser-utils.js';
import { isValidVideoTitle } from './validation.js';
import { decodeHtmlEntitiesAndFixEncoding } from './text-utils.js';
import { TIMEOUTS } from './constants.js';

/**
 * Video Tracker class
 */
export class VideoTracker {
    constructor() {
        this.isInitialized = false;
        this.logger = logger;
        this.titleCache = new Map();
        this.maxCacheSize = 10000;
    }

    /**
     * Initialize video tracker
     * @param {Object} youtubeModule - Reference to Youtube module
     */
    async initialize(youtubeModule) {
        if (this.isInitialized) {
            return;
        }

        this.youtubeModule = youtubeModule;

        try {
            this.logger.info('Initializing video tracker...');

            // Setup hooks
            await this.setupTabHook();
            await this.setupRequestHook();

            this.isInitialized = true;
            this.logger.info('Video tracker initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize video tracker:', error);
            throw error;
        }
    }

    /**
     * Setup tab update hook for tracking navigation
     */
    async setupTabHook() {
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            try {
                if (tabId < 0 || !this.isYouTubeUrl(tab.url)) {
                    return;
                }

                const result = await chrome.storage.sync.get(['idCondition_Brownav']);
                const shouldTrackNavigation = result.idCondition_Brownav === true;

                if (shouldTrackNavigation) {
                    await this.handleTabNavigation(tabId, changeInfo, tab);
                }
            } catch (error) {
                this.logger.error('Error in tab hook:', error);
            }
        });
    }

    /**
     * Setup request hook for tracking video progress
     */
    async setupRequestHook() {
        const result = await chrome.storage.sync.get(['idCondition_Youprog']);
        const shouldTrackProgress = result.idCondition_Youprog === true;

        if (shouldTrackProgress) {
            chrome.webRequest.onSendHeaders.addListener(
                (details) => this.handleProgressRequest(details),
                { urls: ["https://www.youtube.com/api/stats/watchtime*"] }
            );
        }
    }

    /**
     * Check if URL is a YouTube URL
     * @param {string} url - URL to check
     * @returns {boolean} True if YouTube URL
     */
    isYouTubeUrl(url) {
        return url && (
            url.startsWith("https://www.youtube.com") ||
            url.startsWith("https://m.youtube.com")
        );
    }

    /**
     * Check if URL is a YouTube video URL
     * @param {string} url - URL to check
     * @returns {boolean} True if YouTube video URL
     */
    isYouTubeVideoUrl(url) {
        return url && (
            url.startsWith("https://www.youtube.com/watch?v=") ||
            url.startsWith("https://www.youtube.com/shorts/") ||
            url.startsWith("https://m.youtube.com/watch?v=")
        );
    }

    /**
     * Handle tab navigation to YouTube videos
     * @param {number} tabId - Tab ID
     * @param {Object} changeInfo - Change information
     * @param {Object} tab - Tab object
     */
    async handleTabNavigation(tabId, changeInfo, tab) {
        if (!this.isYouTubeVideoUrl(tab.url) || !changeInfo.title) {
            return;
        }

        let title = changeInfo.title;
        if (title.endsWith(" - YouTube")) {
            title = title.slice(0, -10);
        }

        // Normalize encoding to avoid mojibake before validation and saving
        title = decodeHtmlEntitiesAndFixEncoding(title);

        // Don't save videos with generic or invalid titles
        if (!isValidVideoTitle(title)) {
            this.logger.debug('Skipping video with invalid/generic title:', title);

            // Schedule a retry to get a better title after the page loads
            setTimeout(async () => {
                try {
                    const updatedTab = await chrome.tabs.get(tabId);
                    if (updatedTab && this.isYouTubeVideoUrl(updatedTab.url) && updatedTab.title) {
                        let retryTitle = updatedTab.title;
                        if (retryTitle.endsWith(" - YouTube")) {
                            retryTitle = retryTitle.slice(0, -10);
                        }
                        // Normalize encoding on retry as well
                        retryTitle = decodeHtmlEntitiesAndFixEncoding(retryTitle);

                        // Only proceed if we now have a valid title
                        if (isValidVideoTitle(retryTitle)) {
                            this.logger.debug('Retry successful, got valid title:', retryTitle);
                            const videoId = updatedTab.url.split("&")[0].slice(-11);
                            await this.markVideoAsWatched(videoId, retryTitle);
                            await this.notifyYouTubeTabs(videoId, retryTitle);
                        } else {
                            this.logger.debug('Retry still has invalid title:', retryTitle);
                        }
                    }
                } catch (error) {
                    this.logger.debug('Tab retry failed (tab may have been closed):', error.message);
                }
            }, TIMEOUTS.VIEW_COUNT_COOLDOWN / 15); // 2 seconds

            return;
        }

        const videoId = tab.url.split("&")[0].slice(-11);

        try {
            // Mark video as watched
            await this.markVideoAsWatched(videoId, title);

            // Notify all YouTube tabs
            await this.notifyYouTubeTabs(videoId, title);
        } catch (error) {
            this.logger.error('Error handling tab navigation:', error);
        }
    }

    /**
     * Handle progress tracking requests
     * @param {Object} details - Request details
     */
    async handleProgressRequest(details) {
        try {
            if (details.url.includes("muted=1")) {
                return;
            }

            const urlParams = new URLSearchParams(details.url.split('?')[1]);
            const elapsedTimes = urlParams.get('et')?.split(',') || [];
            const videoId = urlParams.get('docid');

            if (!videoId || videoId.length !== 11) {
                return;
            }

            const title = this.titleCache.get(videoId) || "";
            if (!title) {
                return;
            }

            // Check if any elapsed time is significant (> 3 seconds)
            const hasSignificantProgress = elapsedTimes.some(time =>
                parseFloat(time) >= 3.0
            );

            if (hasSignificantProgress) {
                await this.ensureVideoTracked(videoId, title);
                await this.notifyYouTubeTabs(videoId, title);
            }
        } catch (error) {
            this.logger.error('Error handling progress request:', error);
        }
    }

    /**
     * Mark a video as watched
     * @param {string} videoId - Video ID
     * @param {string} title - Video title
     */
    async markVideoAsWatched(videoId, title) {
        return new Promise((resolve, reject) => {
            this.youtubeModule.mark(
                { strIdent: videoId, strTitle: title },
                (response) => {
                    if (response) {
                        this.logger.debug('Video marked as watched:', videoId);
                        resolve(response);
                    } else {
                        reject(new Error('Failed to mark video as watched'));
                    }
                }
            );
        });
    }

    /**
     * Ensure a video is tracked in the database
     * @param {string} videoId - Video ID
     * @param {string} title - Video title
     */
    async ensureVideoTracked(videoId, title) {
        return new Promise((resolve, reject) => {
            try {
                this.youtubeModule.ensure(
                    { strIdent: videoId, strTitle: title },
                    (response) => {
                        if (response) {
                            this.logger.debug('Video ensured:', videoId);
                            resolve(response);
                        } else {
                            this.logger.error('Youtube.ensure returned null response for:', videoId, title);
                            reject(new Error('Failed to ensure video'));
                        }
                    }
                );
            } catch (error) {
                this.logger.error('Error in Youtube.ensure call:', error);
                reject(error);
            }
        });
    }

    /**
     * Notify all YouTube tabs about a marked video
     * @param {string} videoId - Video ID
     * @param {string} title - Video title
     */
    async notifyYouTubeTabs(videoId, title) {
        return new Promise((resolve) => {
            chrome.tabs.query(
                { url: "*://*.youtube.com/*" },
                (tabs) => {
                    tabs.forEach(tab => {
                        sendMessageToTab(tab.id, {
                            action: "youtube-mark",
                            videoId: videoId,
                            timestamp: 0,
                            title: title,
                            count: 0
                        });
                    });
                    resolve();
                }
            );
        });
    }

    /**
     * Add title to cache
     * @param {string} videoId - Video ID
     * @param {string} title - Video title
     */
    cacheTitle(videoId, title) {
        // Implement LRU-like cache with size limit
        if (this.titleCache.size >= this.maxCacheSize) {
            // Remove oldest entries (first 20%)
            const keysToDelete = Array.from(this.titleCache.keys()).slice(0, Math.floor(this.maxCacheSize * 0.2));
            keysToDelete.forEach(key => this.titleCache.delete(key));
        }

        this.titleCache.set(videoId, title);
    }

    /**
     * Get title from cache
     * @param {string} videoId - Video ID
     * @returns {string|undefined} Cached title
     */
    getCachedTitle(videoId) {
        return this.titleCache.get(videoId);
    }

    /**
     * Clear title cache
     */
    clearCache() {
        this.titleCache.clear();
        this.logger.debug('Title cache cleared');
    }
}

/**
 * Create and export default video tracker instance
 */
export const videoTracker = new VideoTracker();

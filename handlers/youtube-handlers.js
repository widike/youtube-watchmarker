// @ts-check

/**
 * YouTube action handlers
 * Handles YouTube-related operations like lookup, ensure, synchronize
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { Youtube } from '../bg-youtube.js';
import { videoTracker } from '../video-tracker.js';

/**
 * Lookup a video in the database
 * @param {Object} request - Request with videoId and optional title
 * @returns {Promise<Object>} Lookup result
 */
export async function handleYoutubeLookup(request) {
    try {
        const { videoId, title } = request;

        if (!videoId) {
            return {
                success: false,
                error: 'Missing video ID'
            };
        }

        if (title) {
            videoTracker.cacheTitle(videoId, title);
        }

        const result = await Youtube.lookup(videoId);
        return result || { success: false, error: 'Video not found' };

    } catch (error) {
        logger.error('YouTube lookup error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Ensure a video exists in the database
 * @param {Object} request - Request with videoId and optional title, timestamp, count
 * @returns {Promise<Object>} Ensure result
 */
export async function handleYoutubeEnsure(request) {
    try {
        const { videoId, title, timestamp, count } = request;

        if (!videoId) {
            return {
                success: false,
                error: 'Missing video ID'
            };
        }

        if (title) {
            videoTracker.cacheTitle(videoId, title);
        }

        const result = await Youtube.ensure(videoId, title, timestamp, count);
        return { success: true, data: result };

    } catch (error) {
        logger.error('YouTube ensure error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Synchronize YouTube history
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleYoutubeSynchronize() {
    try {
        const result = await Youtube.synchronize((progress) => {
            logger.debug('YouTube sync progress:', progress);
        });

        const videoCount = result.videoCount || (result.objVideos?.length) || 0;
        return {
            success: true,
            response: result,
            videoCount
        };
    } catch (error) {
        logger.error('YouTube synchronize error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Synchronize YouTube liked videos
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleYoutubeLikedVideos() {
    try {
        const result = await Youtube.synchronizeLikedVideos((progress) => {
            logger.debug('Liked videos sync progress:', progress);
        });

        return {
            success: true,
            response: result,
            videoCount: result.videoCount || 0
        };
    } catch (error) {
        logger.error('YouTube liked videos sync error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Mark a video as watched
 * @param {Object} request - Request with videoId and optional title, timestamp, count
 * @returns {Promise<Object>} Mark result
 */
export async function handleYoutubeMark(request) {
    try {
        const { videoId, title, timestamp, count } = request;

        if (!videoId) {
            return {
                success: false,
                error: 'Missing video ID'
            };
        }

        const result = await Youtube.mark(videoId, title, timestamp, count);
        return { success: true, data: result };

    } catch (error) {
        logger.error('YouTube mark error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

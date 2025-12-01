/**
 * YouTube action handlers
 * Handles YouTube-related operations like lookup, ensure, synchronize
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';

/**
 * Lookup a video in the database
 * @param {Object} request - Request with strIdent and strTitle
 * @param {Object} youtube - Youtube module instance
 * @param {Function} cacheTitle - Function to cache titles
 * @returns {Promise<Object>} Lookup result
 */
export async function handleYoutubeLookup(request, youtube, cacheTitle) {
    try {
        const { videoId, title } = request;

        if (title) {
            cacheTitle(videoId, title);
        }

        return await new Promise((resolve) => {
            youtube.lookup({ strIdent: videoId, strTitle: title }, resolve);
        });
    } catch (error) {
        logger.error('YouTube lookup error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Ensure a video exists in the database
 * @param {Object} request - Request with strIdent and strTitle
 * @param {Object} youtube - Youtube module instance
 * @param {Function} cacheTitle - Function to cache titles
 * @returns {Promise<Object>} Ensure result
 */
export async function handleYoutubeEnsure(request, youtube, cacheTitle) {
    try {
        const { videoId, title } = request;

        if (title) {
            cacheTitle(videoId, title);
        }

        return await new Promise((resolve) => {
            youtube.ensure({ strIdent: videoId, strTitle: title }, resolve);
        });
    } catch (error) {
        logger.error('YouTube ensure error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Synchronize YouTube history
 * @param {Object} request - Request object
 * @param {Object} youtube - Youtube module instance
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleYoutubeSynchronize(request, youtube) {
    try {
        const result = await new Promise((resolve) => {
            youtube.synchronize(
                { intThreshold: 512 },
                resolve,
                (progress) => logger.debug('YouTube sync progress:', progress)
            );
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
 * @param {Object} request - Request object
 * @param {Object} youtube - Youtube module instance
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleYoutubeLikedVideos(request, youtube) {
    try {
        const result = await new Promise((resolve) => {
            youtube.synchronizeLikedVideos(
                { intThreshold: 512 },
                resolve,
                (progress) => logger.debug('Liked videos sync progress:', progress)
            );
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

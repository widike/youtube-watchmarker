// @ts-check

/**
 * Search action handlers
 * Handles video search and deletion
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { Search } from '../bg-search.js';

/**
 * Search for videos
 * @param {Object} request - Request with query/strQuery, page/intSkip, pageSize/intLength
 * @returns {Promise<Object>} Search result
 */
export async function handleSearchVideos(request) {
    try {
        // Support both old and new parameter names
        const query = request.query !== undefined ? request.query : (request.strQuery || '');

        // Convert page-based pagination to skip-based
        let skip = 0;
        let length = 0;

        if (request.page !== undefined && request.pageSize !== undefined) {
            // New format: page (1-based) and pageSize
            skip = (request.page - 1) * request.pageSize;
            length = request.pageSize;
        } else {
            // Old format: intSkip and intLength
            skip = request.intSkip || 0;
            length = request.intLength || 0;
        }

        const result = await Search.lookup(query, skip, length);

        return {
            success: true,
            objVideos: result.videos,
            totalResults: result.totalResults
        };
    } catch (error) {
        logger.error('Search videos error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

/**
 * Delete a video from database and history
 * @param {Object} request - Request with videoId/strIdent
 * @returns {Promise<Object>} Delete result
 */
export async function handleSearchDelete(request) {
    try {
        // Support both old and new parameter names
        const videoId = request.videoId || request.strIdent;

        if (!videoId) {
            return {
                success: false,
                error: 'Missing video ID'
            };
        }

        const success = await Search.delete(videoId, (progress) => {
            logger.debug('Delete progress:', progress);
        });

        return {
            success: success
        };
    } catch (error) {
        logger.error('Search delete error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

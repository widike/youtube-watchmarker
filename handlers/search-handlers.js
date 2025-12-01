/**
 * Search action handlers
 * Handles video search and deletion operations
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';

/**
 * Search videos in the database
 * @param {Object} request - Request with query, page, pageSize
 * @param {Object} search - Search module instance
 * @param {Object} database - Database instance
 * @returns {Promise<Object>} Search results
 */
export async function handleSearchVideos(request, search, database) {
    try {
        const { query = '', page = 1, pageSize = 50 } = request;

        // Check if database is ready
        if (!database || !database.isInitialized) {
            logger.warn('Database not ready for search request');
            return {
                success: false,
                error: 'Database not initialized yet. Please try again in a moment.',
                results: [],
                totalResults: 0
            };
        }

        // Get all matching results
        const countRequest = {
            strQuery: query,
            intSkip: 0,
            intLength: 999999
        };

        const countResponse = await new Promise((resolve) => {
            search.lookup(countRequest, resolve);
        });

        if (!countResponse || !countResponse.objVideos) {
            const errorMessage = countResponse === null
                ? 'Database connection error. Please try again.'
                : 'No videos found in your watch history.';

            return {
                success: false,
                error: errorMessage,
                results: [],
                totalResults: 0
            };
        }

        const allResults = countResponse.objVideos;
        const totalResults = allResults.length;

        // Calculate pagination
        const skip = (page - 1) * pageSize;
        const paginatedResults = allResults.slice(skip, skip + pageSize);

        const results = paginatedResults.map(video => ({
            id: video.strIdent,
            title: video.strTitle,
            timestamp: video.intTimestamp,
            count: video.intCount
        }));

        return {
            success: true,
            results,
            totalResults,
            currentPage: page,
            pageSize
        };
    } catch (error) {
        logger.error('Search processing error:', error);
        return {
            success: false,
            error: 'Search failed due to an internal error.',
            results: [],
            totalResults: 0
        };
    }
}

/**
 * Delete a video from the database
 * @param {Object} request - Request with videoId
 * @param {Object} search - Search module instance
 * @returns {Promise<Object>} Delete result
 */
export async function handleSearchDelete(request, search) {
    try {
        const { videoId } = request;

        const result = await new Promise((resolve) => {
            search.delete(
                { strIdent: videoId },
                resolve,
                (progress) => logger.debug('Delete progress:', progress)
            );
        });

        if (result) {
            return { success: true };
        } else {
            return { success: false, error: 'Delete failed' };
        }
    } catch (error) {
        logger.error('Delete error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

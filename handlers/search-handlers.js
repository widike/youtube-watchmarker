// @ts-check

/**
 * Search action handlers
 * Handles video search and deletion
 */

import { logger } from '../logger.js';
import { Search } from '../bg-search.js';
import { createHandler } from '../handler-wrapper.js';

/**
 * Search for videos
 */
export const handleSearchVideos = createHandler(
    async (request) => {
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
            objVideos: result.videos,
            totalResults: result.totalResults
        };
    },
    'handleSearchVideos'
);

/**
 * Delete a video from database and history
 */
export const handleSearchDelete = createHandler(
    async (request) => {
        // Support both old and new parameter names
        const videoId = request.videoId || request.strIdent;

        if (!videoId) {
            return { success: false, error: 'Missing video ID' };
        }

        const success = await Search.delete(videoId, (progress) => {
            logger.debug('Delete progress:', progress);
        });

        return { success };
    },
    'handleSearchDelete'
);

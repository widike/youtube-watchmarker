// @ts-check

/**
 * History action handlers
 * Handles browser history synchronization
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';

/**
 * Synchronize browser history
 * @param {Object} request - Request with intTimestamp and skipExisting
 * @param {Object} history - History module instance
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleHistorySynchronize(request, history) {
    try {
        const { intTimestamp = 0, skipExisting = false } = request;

        const result = await history.synchronize(intTimestamp, skipExisting, (progress) => {
            logger.debug('History sync progress:', progress);
        });

        return {
            success: true,
            response: result,
            videoCount: result.videoCount || 0,
            skippedCount: result.skippedCount || 0
        };
    } catch (error) {
        logger.error('History synchronize error:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

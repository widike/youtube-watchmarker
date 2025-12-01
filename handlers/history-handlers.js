// @ts-check

/**
 * History action handlers
 * Handles browser history synchronization
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { History } from '../bg-history.js';

/**
 * Synchronize browser history
 * @param {Object} request - Request with intTimestamp and skipExisting
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleHistorySynchronize(request) {
    try {
        const { intTimestamp = 0, skipExisting = false } = request;

        const result = await History.synchronize(intTimestamp, skipExisting, (progress) => {
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

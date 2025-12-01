/**
 * History action handlers
 * Handles browser history synchronization
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';

/**
 * Synchronize browser history
 * @param {Object} request - Request object
 * @param {Object} history - History module instance
 * @returns {Promise<Object>} Synchronization result
 */
export async function handleHistorySynchronize(request, history) {
    try {
        const result = await new Promise((resolve, reject) => {
            history.synchronize(
                { intTimestamp: 0, skipExisting: true },
                (response) => {
                    if (response === null) {
                        reject(new Error('History synchronization failed'));
                    } else {
                        resolve(response);
                    }
                },
                (progress) => logger.debug('History sync progress:', progress)
            );
        });

        const videoCount = result.videoCount || (result.objVideos?.length) || 0;
        return {
            success: true,
            response: result,
            videoCount
        };
    } catch (error) {
        logger.error('Error synchronizing history:', error);
        return ErrorUtils.createErrorResponse(error);
    }
}

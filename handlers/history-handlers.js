// @ts-check

/**
 * History action handlers
 * Handles browser history synchronization
 */

import { logger } from '../logger.js';
import { History } from '../bg-history.js';
import { createHandler } from '../handler-wrapper.js';

/**
 * Synchronize browser history
 */
export const handleHistorySynchronize = createHandler(
    async (request) => {
        const { intTimestamp = 0, skipExisting = false } = request;

        const result = await History.synchronize(intTimestamp, skipExisting, (progress) => {
            logger.debug('History sync progress:', progress);
        });

        return {
            response: result,
            videoCount: result.videoCount || 0,
            skippedCount: result.skippedCount || 0
        };
    },
    'handleHistorySynchronize'
);

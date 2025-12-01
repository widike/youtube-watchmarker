// @ts-check

/**
 * Database action handlers
 * Handles database operations like export, import, reset, size
 */

import { logger } from '../logger.js';
import { ErrorUtils } from '../error-handler.js';
import { isValidBase64 } from '../validation.js';
import { processInChunks, shouldProcessInChunks } from '../chunk-utils.js';
import { Database } from '../bg-database.js';
import { databaseProviderFactory } from '../database-provider-factory.js';
import { createSimpleHandler, createHandlerWithErrorHandler } from '../handler-wrapper.js';

/**
 * Export database data
 * @returns {Promise<Object>} Export result
 */
export const handleDatabaseExport = createSimpleHandler(
    async () => {
        const data = await Database.export();
        return { data: JSON.stringify(data) };
    },
    'handleDatabaseExport'
);

/**
 * Import database data
 * @param {Object} request - Request object with data field
 * @returns {Promise<Object>} Import result
 */
export const handleDatabaseImport = createHandlerWithErrorHandler(
    async (request) => {
        logger.info('Database import started');

        let parsedData;
        let rawData = request.data;

        // Try to handle base64 encoded old database format first
        if (isValidBase64(rawData)) {
            try {
                const decodedData = atob(rawData);
                rawData = decodedData;
                logger.info('Successfully decoded base64 database format');
            } catch (base64Error) {
                logger.warn('Base64 decoding failed:', base64Error);
            }
        }

        // Parse as JSON
        try {
            parsedData = JSON.parse(rawData);
        } catch (jsonError) {
            logger.error('Failed to parse database as JSON:', jsonError);
            return {
                success: false,
                error: 'Invalid database format. Please ensure the file contains valid JSON data.'
            };
        }

        // Handle legacy DB format - if parsedData is an array, wrap it
        if (Array.isArray(parsedData)) {
            parsedData = {
                data: parsedData.map(video => ({
                    strIdent: video.strIdent,
                    intTimestamp: video.longTimestamp || video.intTimestamp || Date.now(),
                    strTitle: video.strTitle || '',
                    intCount: video.intCount || 1
                }))
            };
        }

        const videoData = parsedData.data || [];
        logger.info(`Importing ${videoData.length} videos`);

        // Use chunk processing utility for large datasets
        if (shouldProcessInChunks(videoData)) {
            const result = await processInChunks(
                videoData,
                async (chunk) => await Database.import(chunk),
                {
                    progressCallback: (progress) => {
                        logger.info(`Import progress: ${progress.percentage}% (${progress.itemsProcessed}/${progress.totalItems})`);
                    }
                }
            );
            return result;
        } else {
            // For smaller datasets, use single-pass import
            await Database.import(videoData);
            return {
                message: `Successfully imported ${videoData.length} videos`
            };
        }
    },
    (error) => ErrorUtils.handleDatabaseError(error, 'import'),
    'handleDatabaseImport'
);

/**
 * Reset database
 * @returns {Promise<Object>} Reset result
 */
export const handleDatabaseReset = createHandlerWithErrorHandler(
    async () => {
        await Database.reset();
        return { message: 'Database reset successfully' };
    },
    (error) => ErrorUtils.handleDatabaseError(error, 'reset'),
    'handleDatabaseReset'
);

/**
 * Get database size
 * @returns {Promise<Object>} Size result
 */
export const handleDatabaseSize = createHandlerWithErrorHandler(
    async () => {
        const currentProvider = databaseProviderFactory.getCurrentProvider();
        if (!currentProvider) {
            return { success: false, error: 'No database provider available' };
        }

        const count = await currentProvider.getVideoCount();
        return { size: count.toString() };
    },
    (error) => ErrorUtils.handleDatabaseError(error, 'get size'),
    'handleDatabaseSize'
);

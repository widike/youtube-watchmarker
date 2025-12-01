/**
 * Database action handlers
 * Handles database operations like export, import, reset, size
 */

import { logger } from '../logger.js';
import { ErrorHandler, ErrorUtils } from '../error-handler.js';
import { isValidBase64 } from '../validation.js';

/**
 * Export database data
 * @param {Object} request - Request object
 * @param {Object} database - Database instance
 * @returns {Promise<Object>} Export result
 */
export async function handleDatabaseExport(request, database) {
    try {
        const store = database.getObjectStore("readonly");
        const data = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(new Error('Failed to export database'));
        });

        return {
            success: true,
            data: JSON.stringify(data)
        };
    } catch (error) {
        return ErrorUtils.handleDatabaseError(error, 'export');
    }
}

/**
 * Import database data
 * @param {Object} request - Request object with data field
 * @param {Object} database - Database instance
 * @returns {Promise<Object>} Import result
 */
export async function handleDatabaseImport(request, database) {
    try {
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

        // Process in chunks for large datasets
        const chunkSize = videoData.length > 50000 ? 500 :
            videoData.length > 10000 ? 750 : 1000;

        if (videoData.length > chunkSize) {
            return await processChunksSequentially(videoData, chunkSize, database);
        } else {
            // For smaller datasets, use single-pass import
            await database.import({ data: parsedData }, () => { });
            return {
                success: true,
                message: `Successfully imported ${videoData.length} videos`
            };
        }
    } catch (error) {
        return ErrorUtils.handleDatabaseError(error, 'import');
    }
}

/**
 * Process import chunks sequentially
 * @param {Array} videoData - Video data array
 * @param {number} chunkSize - Chunk size
 * @param {Object} database - Database instance
 * @returns {Promise<Object>} Result
 */
async function processChunksSequentially(videoData, chunkSize, database) {
    const totalVideos = videoData.length;
    const totalChunks = Math.ceil(totalVideos / chunkSize);

    for (let i = 0; i < totalVideos; i += chunkSize) {
        const chunk = videoData.slice(i, i + chunkSize);
        const chunkNumber = Math.floor(i / chunkSize) + 1;

        logger.info(`Processing chunk ${chunkNumber}/${totalChunks}`);

        await new Promise((resolve, reject) => {
            database.import({ data: { data: chunk } }, (response) => {
                if (response && response.success) {
                    resolve();
                } else {
                    reject(new Error(`Failed to import chunk ${chunkNumber}`));
                }
            });
        });

        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 150));
    }

    return {
        success: true,
        message: `Successfully imported ${totalVideos} videos in ${totalChunks} chunks`
    };
}

/**
 * Reset database
 * @param {Object} request - Request object
 * @param {Object} database - Database instance
 * @returns {Promise<Object>} Reset result
 */
export async function handleDatabaseReset(request, database) {
    try {
        await new Promise((resolve, reject) => {
            database.reset({}, (response) => {
                if (response && response.success) {
                    resolve();
                } else {
                    reject(new Error('Reset failed'));
                }
            });
        });

        return { success: true, message: 'Database reset successfully' };
    } catch (error) {
        return ErrorUtils.handleDatabaseError(error, 'reset');
    }
}

/**
 * Get database size
 * @param {Object} request - Request object
 * @param {Object} providerFactory - Provider factory instance
 * @returns {Promise<Object>} Size result
 */
export async function handleDatabaseSize(request, providerFactory) {
    try {
        const currentProvider = providerFactory.getCurrentProvider();
        if (!currentProvider) {
            return { success: false, error: 'No database provider available' };
        }

        const count = await currentProvider.getVideoCount();
        return { success: true, size: count.toString() };
    } catch (error) {
        return ErrorUtils.handleDatabaseError(error, 'get size');
    }
}

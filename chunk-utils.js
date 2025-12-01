// @ts-check

/**
 * Chunk processing utilities for handling large datasets
 * @module chunk-utils
 */

import { logger } from './logger.js';
import { IMPORT_EXPORT, TIMEOUTS } from './constants.js';

/**
 * @typedef {Object} ChunkProcessingOptions
 * @property {number} [largeThreshold] - Threshold for large datasets (default: 50000)
 * @property {number} [mediumThreshold] - Threshold for medium datasets (default: 10000)
 * @property {number} [largeChunkSize] - Chunk size for large datasets (default: 500)
 * @property {number} [mediumChunkSize] - Chunk size for medium datasets (default: 750)
 * @property {number} [smallChunkSize] - Chunk size for small datasets (default: 1000)
 * @property {number} [delayMs] - Delay between chunks in milliseconds (default: 150)
 * @property {Function} [progressCallback] - Callback for progress updates
 */

/**
 * @typedef {Object} ChunkProcessingResult
 * @property {boolean} success - Whether processing succeeded
 * @property {string} message - Result message
 * @property {number} totalItems - Total number of items processed
 * @property {number} totalChunks - Total number of chunks processed
 */

/**
 * Determine optimal chunk size based on dataset size
 * @param {number} dataLength - Length of the dataset
 * @param {ChunkProcessingOptions} [options] - Processing options
 * @returns {number} Optimal chunk size
 */
export function getOptimalChunkSize(dataLength, options = {}) {
    const largeThreshold = options.largeThreshold || IMPORT_EXPORT.LARGE_DATASET_THRESHOLD;
    const mediumThreshold = options.mediumThreshold || IMPORT_EXPORT.MEDIUM_DATASET_THRESHOLD;
    const largeChunkSize = options.largeChunkSize || IMPORT_EXPORT.CHUNK_SIZE_LARGE;
    const mediumChunkSize = options.mediumChunkSize || IMPORT_EXPORT.CHUNK_SIZE_MEDIUM;
    const smallChunkSize = options.smallChunkSize || IMPORT_EXPORT.CHUNK_SIZE_SMALL;

    if (dataLength > largeThreshold) {
        return largeChunkSize;
    } else if (dataLength > mediumThreshold) {
        return mediumChunkSize;
    } else {
        return smallChunkSize;
    }
}

/**
 * Process an array in chunks with a processor function
 * @template T
 * @param {T[]} data - Array of data to process
 * @param {function(T[]): Promise<any>} processorFn - Function to process each chunk
 * @param {ChunkProcessingOptions} [options] - Processing options
 * @returns {Promise<ChunkProcessingResult>} Processing result
 */
export async function processInChunks(data, processorFn, options = {}) {
    if (!Array.isArray(data)) {
        throw new Error('Data must be an array');
    }

    if (typeof processorFn !== 'function') {
        throw new Error('Processor function is required');
    }

    const totalItems = data.length;
    const chunkSize = getOptimalChunkSize(totalItems, options);
    const totalChunks = Math.ceil(totalItems / chunkSize);
    const delayMs = options.delayMs !== undefined ? options.delayMs : TIMEOUTS.CHUNK_PROCESSING_DELAY;
    const progressCallback = options.progressCallback;

    logger.info(`Processing ${totalItems} items in ${totalChunks} chunks (chunk size: ${chunkSize})`);

    for (let i = 0; i < totalItems; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        const chunkNumber = Math.floor(i / chunkSize) + 1;

        logger.debug(`Processing chunk ${chunkNumber}/${totalChunks}`);

        // Call progress callback if provided
        if (progressCallback) {
            progressCallback({
                current: chunkNumber,
                total: totalChunks,
                itemsProcessed: i + chunk.length,
                totalItems: totalItems,
                percentage: Math.round((i + chunk.length) / totalItems * 100)
            });
        }

        // Process the chunk
        await processorFn(chunk);

        // Add delay between chunks (except for the last one)
        if (i + chunkSize < totalItems && delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return {
        success: true,
        message: `Successfully processed ${totalItems} items in ${totalChunks} chunks`,
        totalItems,
        totalChunks
    };
}

/**
 * Process an array in parallel chunks (useful for independent operations)
 * @template T
 * @param {T[]} data - Array of data to process
 * @param {function(T[]): Promise<any>} processorFn - Function to process each chunk
 * @param {ChunkProcessingOptions & {maxParallel?: number}} [options] - Processing options
 * @returns {Promise<ChunkProcessingResult>} Processing result
 */
export async function processInParallelChunks(data, processorFn, options = {}) {
    if (!Array.isArray(data)) {
        throw new Error('Data must be an array');
    }

    if (typeof processorFn !== 'function') {
        throw new Error('Processor function is required');
    }

    const totalItems = data.length;
    const chunkSize = getOptimalChunkSize(totalItems, options);
    const maxParallel = options.maxParallel || 4;
    const progressCallback = options.progressCallback;

    // Split data into chunks
    const chunks = [];
    for (let i = 0; i < totalItems; i += chunkSize) {
        chunks.push(data.slice(i, i + chunkSize));
    }

    const totalChunks = chunks.length;
    logger.info(`Processing ${totalItems} items in ${totalChunks} parallel chunks (chunk size: ${chunkSize}, max parallel: ${maxParallel})`);

    let processedChunks = 0;
    let processedItems = 0;

    // Process chunks in batches to limit parallelism
    for (let i = 0; i < totalChunks; i += maxParallel) {
        const batch = chunks.slice(i, i + maxParallel);

        await Promise.all(
            batch.map(async (chunk, batchIndex) => {
                const chunkNumber = i + batchIndex + 1;
                logger.debug(`Processing chunk ${chunkNumber}/${totalChunks}`);

                await processorFn(chunk);

                processedChunks++;
                processedItems += chunk.length;

                // Call progress callback if provided
                if (progressCallback) {
                    progressCallback({
                        current: processedChunks,
                        total: totalChunks,
                        itemsProcessed: processedItems,
                        totalItems: totalItems,
                        percentage: Math.round(processedItems / totalItems * 100)
                    });
                }
            })
        );
    }

    return {
        success: true,
        message: `Successfully processed ${totalItems} items in ${totalChunks} parallel chunks`,
        totalItems,
        totalChunks
    };
}

/**
 * Check if data should be processed in chunks
 * @param {any[]} data - Array of data
 * @param {ChunkProcessingOptions} [options] - Processing options
 * @returns {boolean} True if data should be chunked
 */
export function shouldProcessInChunks(data, options = {}) {
    if (!Array.isArray(data)) {
        return false;
    }

    const chunkSize = getOptimalChunkSize(data.length, options);
    return data.length > chunkSize;
}

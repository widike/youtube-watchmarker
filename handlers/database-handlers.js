// @ts-check

/**
 * Database action handlers
 * Handles database operations like export, import, reset, size
 */

import { logger } from "../logger.js";
import { ErrorUtils } from "../error-handler.js";
import { processInChunks, shouldProcessInChunks } from "../chunk-utils.js";
import { Database } from "../bg-database.js";
import { databaseProviderFactory } from "../database-provider-factory.js";
import { parseHistoryImport } from "../history-import.js";
import { createHandler } from "../handler-wrapper.js";
import { readMetadata } from "../history-storage.js";
import { RECONCILIATION_KEY } from "../history-repair-storage.js";

/**
 * Export database data
 * @returns {Promise<Object>} Export result
 */
export const handleDatabaseExport = createHandler(
  async () => {
    const data = await Database.export();
    return { data: JSON.stringify(data) };
  },
  { name: "handleDatabaseExport" },
);

/**
 * Import database data
 * @param {Object} request - Request object with data field
 * @returns {Promise<Object>} Import result
 */
export const handleDatabaseImport = createHandler(
  async (request) => {
    logger.info("Database import started");

    let videoData;
    try {
      videoData = parseHistoryImport(request.data);
    } catch (error) {
      return { success: false, error: error.message };
    }
    logger.info(`Importing ${videoData.length} videos`);

    // Use chunk processing utility for large datasets
    if (shouldProcessInChunks(videoData)) {
      const result = await processInChunks(
        videoData,
        async (chunk) => await Database.import(chunk),
        {
          progressCallback: (progress) => {
            logger.info(
              `Import progress: ${progress.percentage}% (${progress.itemsProcessed}/${progress.totalItems})`,
            );
          },
        },
      );
      return result;
    } else {
      // For smaller datasets, use single-pass import
      await Database.import(videoData);
      return {
        message: `Successfully imported ${videoData.length} videos`,
      };
    }
  },
  {
    name: "handleDatabaseImport",
    errorHandler: (error) => ErrorUtils.handleDatabaseError(error, "import"),
  },
);

/**
 * Get database size
 * @returns {Promise<Object>} Size result
 */
export const handleDatabaseSize = createHandler(
  async () => {
    const currentProvider = databaseProviderFactory.getCurrentProvider();
    if (!currentProvider) {
      return { success: false, error: "No database provider available" };
    }

    const count = await currentProvider.getVideoCount();
    const reconciliation = await readMetadata(
      Database.database,
      RECONCILIATION_KEY,
    );
    return { size: count.toString(), reconciliation };
  },
  {
    name: "handleDatabaseSize",
    errorHandler: (error) => ErrorUtils.handleDatabaseError(error, "get size"),
  },
);

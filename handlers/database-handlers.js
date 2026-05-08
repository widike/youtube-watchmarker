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
import {
  auditDatabaseIntegrity,
  exportIntegrityBackup,
  repairDatabaseIntegrity,
} from "../database-maintenance.js";
import {
  createSimpleHandler,
  createHandlerWithErrorHandler,
} from "../handler-wrapper.js";

/**
 * Export database data
 * @returns {Promise<Object>} Export result
 */
export const handleDatabaseExport = createSimpleHandler(async () => {
  const data = await Database.export();
  return { data: JSON.stringify(data) };
}, "handleDatabaseExport");

/**
 * Import database data
 * @param {Object} request - Request object with data field
 * @returns {Promise<Object>} Import result
 */
export const handleDatabaseImport = createHandlerWithErrorHandler(
  async (request) => {
    logger.info("Database import started");

    let parsedData;
    const rawData = request.data;

    // Parse as JSON
    try {
      parsedData = JSON.parse(rawData);
    } catch (jsonError) {
      logger.error("Failed to parse database as JSON:", jsonError);
      return {
        success: false,
        error:
          "Invalid database format. Please ensure the file contains valid JSON data.",
      };
    }

    if (
      !parsedData ||
      typeof parsedData !== "object" ||
      !Array.isArray(parsedData.data)
    ) {
      return {
        success: false,
        error: "Invalid database format. Expected an object with a data array.",
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
  (error) => ErrorUtils.handleDatabaseError(error, "import"),
  "handleDatabaseImport",
);

/**
 * Reset database
 * @returns {Promise<Object>} Reset result
 */
export const handleDatabaseReset = createHandlerWithErrorHandler(
  async () => {
    await Database.reset();
    return { message: "Database reset successfully" };
  },
  (error) => ErrorUtils.handleDatabaseError(error, "reset"),
  "handleDatabaseReset",
);

/**
 * Get database size
 * @returns {Promise<Object>} Size result
 */
export const handleDatabaseSize = createHandlerWithErrorHandler(
  async () => {
    const currentProvider = databaseProviderFactory.getCurrentProvider();
    if (!currentProvider) {
      return { success: false, error: "No database provider available" };
    }

    const count = await currentProvider.getVideoCount();
    return { size: count.toString() };
  },
  (error) => ErrorUtils.handleDatabaseError(error, "get size"),
  "handleDatabaseSize",
);

/**
 * Audit database integrity without modifying data.
 * @returns {Promise<Object>} Audit result
 */
export const handleDatabaseIntegrityCheck = createHandlerWithErrorHandler(
  async () => {
    const result = await auditDatabaseIntegrity();
    return { result };
  },
  (error) => ErrorUtils.handleDatabaseError(error, "integrity check"),
  "handleDatabaseIntegrityCheck",
);

/**
 * Export raw provider data before integrity repair.
 * @returns {Promise<Object>} Backup payload
 */
export const handleDatabaseIntegrityBackup = createHandlerWithErrorHandler(
  async () => {
    const backup = await exportIntegrityBackup();
    return { data: JSON.stringify(backup) };
  },
  (error) => ErrorUtils.handleDatabaseError(error, "integrity backup"),
  "handleDatabaseIntegrityBackup",
);

/**
 * Repair database duplicate IDs and suspicious timestamp clusters.
 * @returns {Promise<Object>} Repair result
 */
export const handleDatabaseIntegrityRepair = createHandlerWithErrorHandler(
  async () => {
    const result = await repairDatabaseIntegrity();
    return { result };
  },
  (error) => ErrorUtils.handleDatabaseError(error, "integrity repair"),
  "handleDatabaseIntegrityRepair",
);

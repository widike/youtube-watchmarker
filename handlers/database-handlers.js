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

function normalizeImportedVideo(video) {
  const timestamp = Number(video.intTimestamp || video.int_timestamp);
  const count = Number(video.intCount || video.int_count || 1);

  return {
    strIdent: String(video.strIdent || video.str_ident || "").trim(),
    intTimestamp:
      Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0,
    strTitle: video.strTitle || video.str_title || "",
    intCount: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
  };
}

function getImportRows(parsedData) {
  if (Array.isArray(parsedData)) {
    return parsedData;
  }

  if (Array.isArray(parsedData?.data)) {
    return parsedData.data;
  }

  if (Array.isArray(parsedData?.rows)) {
    return parsedData.rows;
  }

  if (Array.isArray(parsedData?.providers?.indexedDB)) {
    return parsedData.providers.indexedDB;
  }

  if (Array.isArray(parsedData?.providers?.supabase)) {
    return parsedData.providers.supabase;
  }

  return null;
}

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

    const importRows = getImportRows(parsedData);

    if (!importRows) {
      return {
        success: false,
        error:
          "Invalid database format. Expected a YouTube Watchmarker export array.",
      };
    }

    const videoData = importRows
      .map(normalizeImportedVideo)
      .filter((video) => video.strIdent);
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

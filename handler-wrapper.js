// @ts-check

/**
 * Handler Wrapper Utility
 * Provides reusable wrapper for handler functions with consistent error handling
 */

import { logger } from "./logger.js";
import { ErrorUtils } from "./error-handler.js";

/**
 * @typedef {Object} HandlerOptions
 * @property {string} [name='handler'] - Name of the handler (for logging)
 * @property {boolean} [requiresRequest=true] - Whether handler requires request parameter
 * @property {Function} [errorHandler] - Custom error handler function (defaults to ErrorUtils.createErrorResponse)
 */

/**
 * Creates a handler with consistent error handling and logging
 * Unified wrapper that replaces createHandler, createSimpleHandler, and createHandlerWithErrorHandler
 *
 * @param {Function} handlerFn - The handler function to wrap
 * @param {string|HandlerOptions} [options] - Handler name or options object
 * @returns {Function} Wrapped handler function
 *
 * @example
 * // Simple handler with request
 * export const handleYoutubeLookup = createHandler(
 *     async (request) => {
 *         const result = await Youtube.lookup(request.videoId);
 *         return { data: result };
 *     },
 *     'handleYoutubeLookup'
 * );
 *
 * @example
 * // Handler without request parameter
 * export const handleDatabaseExport = createHandler(
 *     async () => {
 *         const data = await Database.export();
 *         return { data: JSON.stringify(data) };
 *     },
 *     { name: 'handleDatabaseExport', requiresRequest: false }
 * );
 *
 * @example
 * // Handler with custom error handler
 * export const handleDatabaseImport = createHandler(
 *     async (request) => {
 *         await Database.import(request.data);
 *         return { message: 'Import successful' };
 *     },
 *     { name: 'handleDatabaseImport', errorHandler: (error) => ErrorUtils.handleDatabaseError(error, 'import') }
 * );
 */
export function createHandler(handlerFn, options = {}) {
  // Support legacy signature: createHandler(fn, 'handlerName')
  const opts = typeof options === "string" ? { name: options } : options;

  const {
    name = "handler",
    requiresRequest = true,
    errorHandler = (error) => ErrorUtils.createErrorResponse(error),
  } = opts;

  return async (request, ...args) => {
    try {
      logger.debug(`Executing ${name}`);
      const result = requiresRequest
        ? await handlerFn(request, ...args)
        : await handlerFn(...args);

      // Ensure result has success field
      if (result && typeof result === "object" && !("success" in result)) {
        return { success: true, ...result };
      }

      return result || { success: true };
    } catch (error) {
      logger.error(`Error in ${name}:`, error);
      return errorHandler(error);
    }
  };
}

/**
 * Creates a simple handler that doesn't require request parameter
 * @deprecated Use createHandler with { requiresRequest: false } option instead
 *
 * @param {Function} handlerFn - The handler function to wrap (no request param)
 * @param {string} handlerName - Name of the handler (for logging)
 * @returns {Function} Wrapped handler function
 */
export function createSimpleHandler(handlerFn, handlerName = "handler") {
  return createHandler(handlerFn, {
    name: handlerName,
    requiresRequest: false,
  });
}

/**
 * Creates a handler with custom error handler
 * @deprecated Use createHandler with errorHandler option instead
 *
 * @param {Function} handlerFn - The handler function to wrap
 * @param {Function} errorHandler - Custom error handler function
 * @param {string} handlerName - Name of the handler (for logging)
 * @returns {Function} Wrapped handler function
 */
export function createHandlerWithErrorHandler(
  handlerFn,
  errorHandler,
  handlerName = "handler",
) {
  return createHandler(handlerFn, { name: handlerName, errorHandler });
}

// @ts-check

/**
 * Handler Wrapper Utility
 * Provides reusable wrapper for handler functions with consistent error handling
 */

import { logger } from './logger.js';
import { ErrorUtils } from './error-handler.js';

/**
 * Wraps a handler function with consistent error handling and logging
 * 
 * @param {Function} handlerFn - The handler function to wrap
 * @param {string} handlerName - Name of the handler (for logging)
 * @returns {Function} Wrapped handler function
 * 
 * @example
 * export const handleDatabaseExport = createHandler(
 *     async () => {
 *         const data = await Database.export();
 *         return { success: true, data: JSON.stringify(data) };
 *     },
 *     'handleDatabaseExport'
 * );
 */
export function createHandler(handlerFn, handlerName = 'handler') {
    return async (request, ...args) => {
        try {
            logger.debug(`Executing ${handlerName}`);
            const result = await handlerFn(request, ...args);

            // Ensure result has success field
            if (result && typeof result === 'object' && !('success' in result)) {
                return { success: true, ...result };
            }

            return result || { success: true };
        } catch (error) {
            logger.error(`Error in ${handlerName}:`, error);
            return ErrorUtils.createErrorResponse(error);
        }
    };
}

/**
 * Creates a simple handler that doesn't require request parameter
 * 
 * @param {Function} handlerFn - The handler function to wrap (no request param)
 * @param {string} handlerName - Name of the handler (for logging)
 * @returns {Function} Wrapped handler function
 * 
 * @example
 * export const handleDatabaseExport = createSimpleHandler(
 *     async () => {
 *         const data = await Database.export();
 *         return { data: JSON.stringify(data) };
 *     },
 *     'handleDatabaseExport'
 * );
 */
export function createSimpleHandler(handlerFn, handlerName = 'handler') {
    return async () => {
        try {
            logger.debug(`Executing ${handlerName}`);
            const result = await handlerFn();

            // Ensure result has success field
            if (result && typeof result === 'object' && !('success' in result)) {
                return { success: true, ...result };
            }

            return result || { success: true };
        } catch (error) {
            logger.error(`Error in ${handlerName}:`, error);
            return ErrorUtils.createErrorResponse(error);
        }
    };
}

/**
 * Creates a handler with custom error handler
 * 
 * @param {Function} handlerFn - The handler function to wrap
 * @param {Function} errorHandler - Custom error handler function
 * @param {string} handlerName - Name of the handler (for logging)
 * @returns {Function} Wrapped handler function
 * 
 * @example
 * export const handleDatabaseImport = createHandlerWithErrorHandler(
 *     async (request) => {
 *         await Database.import(request.data);
 *         return { message: 'Import successful' };
 *     },
 *     (error) => ErrorUtils.handleDatabaseError(error, 'import'),
 *     'handleDatabaseImport'
 * );
 */
export function createHandlerWithErrorHandler(handlerFn, errorHandler, handlerName = 'handler') {
    return async (request, ...args) => {
        try {
            logger.debug(`Executing ${handlerName}`);
            const result = await handlerFn(request, ...args);

            // Ensure result has success field
            if (result && typeof result === 'object' && !('success' in result)) {
                return { success: true, ...result };
            }

            return result || { success: true };
        } catch (error) {
            logger.error(`Error in ${handlerName}:`, error);
            return errorHandler(error);
        }
    };
}

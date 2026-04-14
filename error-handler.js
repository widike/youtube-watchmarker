// @ts-check

/**
 * Error handling system for YouTube Watchmarker
 * Simplified to essential error types with integrated logging
 */

import { logger } from "./logger.js";

/**
 * Custom error types for the YouTube Watchmarker extension
 */
export class ExtensionError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

export class DatabaseError extends ExtensionError {
  constructor(message, details = {}) {
    super(message, "DATABASE_ERROR", details);
  }
}

export class NetworkError extends ExtensionError {
  constructor(message, details = {}) {
    super(message, "NETWORK_ERROR", details);
  }
}

export class ValidationError extends ExtensionError {
  constructor(message, details = {}) {
    super(message, "VALIDATION_ERROR", details);
  }
}

/**
 * Centralized error handler for the extension
 */
export class ErrorHandler {
  constructor() {
    this.errorLog = [];
    this.maxLogSize = 100;
  }

  /**
   * Handle and log errors
   * @param {Error} error - The error to handle
   * @param {Object} [context={}] - Additional context information
   * @param {boolean} [shouldThrow=false] - Whether to re-throw the error
   * @returns {Object} The created error entry
   */
  handle(error, context = {}, shouldThrow = false) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: error.message,
      code: error.code || "UNKNOWN_ERROR",
      stack: error.stack,
      context: context,
      type: error.constructor.name,
    };

    // Add to error log
    this.errorLog.unshift(errorEntry);
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.pop();
    }

    // Log using the logger
    this.logError(error, context);

    if (shouldThrow) {
      throw error;
    }

    return errorEntry;
  }

  /**
   * Log error with appropriate level
   * @param {Error} error - The error to log
   * @param {Object} context - Additional context
   */
  logError(error, context) {
    const logMessage = `${error.constructor.name}: ${error.message}`;

    if (error instanceof ValidationError) {
      logger.warn(logMessage, context);
    } else if (
      error instanceof NetworkError ||
      error instanceof DatabaseError
    ) {
      logger.error(logMessage, { context, stack: error.stack });
    } else {
      logger.error(logMessage, { context, stack: error.stack });
    }
  }

  /**
   * Create a safe wrapper for async functions
   * @param {Function} fn - The async function to wrap
   * @param {Object} defaultReturn - Default return value on error
   * @returns {Function} Wrapped function
   */
  wrapAsync(fn, defaultReturn = null) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handle(error, {
          function: fn.name,
          arguments: args.map((arg) =>
            typeof arg === "object" ? "[Object]" : arg,
          ),
        });
        return defaultReturn;
      }
    };
  }

  /**
   * Validate required parameters
   * @param {Object} params - Parameters to validate
   * @param {Array} required - Required parameter names
   * @throws {ValidationError} If validation fails
   */
  validateRequired(params, required) {
    const missing = required.filter(
      (key) => params[key] === undefined || params[key] === null,
    );

    if (missing.length > 0) {
      throw new ValidationError(
        `Missing required parameters: ${missing.join(", ")}`,
        { missing, provided: Object.keys(params) },
      );
    }
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getStatistics() {
    const errorsByType = {};
    const errorsByCode = {};

    this.errorLog.forEach((error) => {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
      errorsByCode[error.code] = (errorsByCode[error.code] || 0) + 1;
    });

    return {
      totalErrors: this.errorLog.length,
      errorsByType,
      errorsByCode,
      recentErrors: this.errorLog.slice(0, 5),
    };
  }

  /**
   * Clear error logs
   */
  clearLogs() {
    this.errorLog = [];
  }
}

// Create and export singleton instance
export const errorHandler = new ErrorHandler();

/**
 * Serialize any error type to a consistent object format
 * Prevents [object Object] in logs by handling all possible input types
 * @param {*} error - The error to serialize (can be any type)
 * @returns {Object} Serialized error with message, code, and optional details
 */
export function serializeError(error) {
  // Handle null/undefined
  if (error === null || error === undefined) {
    return {
      message: "Unknown error (null or undefined)",
      code: "UNKNOWN_ERROR",
      type: "null",
    };
  }

  // Handle string errors
  if (typeof error === "string") {
    return {
      message: error,
      code: "STRING_ERROR",
      type: "string",
    };
  }

  // Handle Error instances (including custom ExtensionError subclasses)
  if (error instanceof Error) {
    return {
      message: error.message || "Unknown error",
      code: error.code || "ERROR",
      type: error.name || error.constructor.name || "Error",
      stack: error.stack,
      details: error.details || undefined,
    };
  }

  // Handle Response objects (from fetch)
  if (
    error &&
    typeof error.status === "number" &&
    typeof error.statusText === "string"
  ) {
    return {
      message: `HTTP ${error.status}: ${error.statusText}`,
      code: `HTTP_${error.status}`,
      type: "Response",
      status: error.status,
    };
  }

  // Handle plain objects
  if (typeof error === "object") {
    // Check for common error-like properties
    if (error.message || error.error || error.msg) {
      return {
        message: error.message || error.error || error.msg || "Unknown error",
        code: error.code || error.errorCode || "OBJECT_ERROR",
        type: "object",
        details: error,
      };
    }

    // Fallback: stringify the object
    try {
      const stringified = JSON.stringify(error);
      // Avoid huge objects in error messages
      const truncated =
        stringified.length > 200
          ? stringified.slice(0, 200) + "..."
          : stringified;
      return {
        message: `Object error: ${truncated}`,
        code: "OBJECT_ERROR",
        type: "object",
        raw: error,
      };
    } catch (_jsonError) {
      // Circular reference or other JSON issues
      return {
        message: `Unserializable object: ${Object.prototype.toString.call(error)}`,
        code: "UNSERIALIZABLE_ERROR",
        type: "object",
        keys: Object.keys(error).slice(0, 10),
      };
    }
  }

  // Handle primitives (numbers, booleans, etc.)
  return {
    message: String(error),
    code: "PRIMITIVE_ERROR",
    type: typeof error,
  };
}

/**
 * Utility functions for common error scenarios
 */
export const ErrorUtils = {
  /**
   * Handle database operation errors
   * @param {Error} error - The error that occurred
   * @param {string} operation - The operation that failed
   * @param {Object} context - Additional context
   * @returns {Object} Error response
   */
  handleDatabaseError(error, operation, context = {}) {
    const dbError = new DatabaseError(
      `Database ${operation} failed: ${error.message}`,
      { operation, originalError: error.message, ...context },
    );
    errorHandler.handle(dbError, context);
    return this.createErrorResponse(dbError);
  },

  /**
   * Handle network request errors
   * @param {Error} error - The error that occurred
   * @param {string} url - The URL that failed
   * @param {Object} context - Additional context
   * @returns {Object} Error response
   */
  handleNetworkError(error, url, context = {}) {
    const networkError = new NetworkError(
      `Network request failed: ${error.message}`,
      { url, originalError: error.message, ...context },
    );
    errorHandler.handle(networkError, context);
    return this.createErrorResponse(networkError);
  },

  /**
   * Create a standardized error response
   * Handles any error type, preventing [object Object] in responses
   * @param {*} error - The error that occurred (can be any type)
   * @returns {Object} Standardized error response
   */
  createErrorResponse(error) {
    const serialized = serializeError(error);
    return {
      success: false,
      error: serialized.message,
      code: serialized.code,
      type: serialized.type,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Create a standardized success response
   * @param {*} data - The response data
   * @param {string} message - Success message
   * @returns {Object} Standardized success response
   */
  createSuccessResponse(
    data = null,
    message = "Operation completed successfully",
  ) {
    return {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
    };
  },
};

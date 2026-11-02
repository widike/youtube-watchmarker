import { logger } from "./logger.js";
import { ErrorUtils } from "./error-handler.js";

/** One handler signature; functions that need no request simply ignore it. */
export function createHandler(
  handler,
  { name = "handler", errorHandler = ErrorUtils.createErrorResponse } = {},
) {
  return async (...args) => {
    try {
      const result = await handler(...args);
      return { success: true, ...result };
    } catch (error) {
      logger.error(`Error in ${name}:`, error);
      return errorHandler(error);
    }
  };
}

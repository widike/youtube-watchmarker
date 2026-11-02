/** Errors are serialized once at the messaging boundary, without request data. */
export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.code = "VALIDATION_ERROR";
  }
}

function errorMessage(error) {
  if (typeof error === "string") return error;
  return typeof error?.message === "string" && error.message
    ? error.message
    : "An unexpected error occurred";
}

export const ErrorUtils = {
  createErrorResponse(error) {
    return {
      success: false,
      error: errorMessage(error),
      code: typeof error?.code === "string" ? error.code : "ERROR",
    };
  },

  handleDatabaseError(error, operation) {
    return {
      success: false,
      error: `Database ${operation} failed: ${errorMessage(error)}`,
      code: "DATABASE_ERROR",
    };
  },
};

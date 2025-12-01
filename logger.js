// @ts-check

/**
 * Logging utility for YouTube Watchmarker
 * Provides consistent logging with levels and formatting
 */

/**
 * Log levels
 */
export const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

/**
 * Logger class with configurable log levels
 */
export class Logger {
    constructor(name, minLevel = LogLevel.INFO) {
        this.name = name;
        this.minLevel = minLevel;
    }

    /**
     * Set minimum log level
     * @param {number} level - Log level from LogLevel enum
     */
    setLevel(level) {
        this.minLevel = level;
    }

    /**
     * Format log message
     * @param {string} level - Log level name
     * @param {string} message - Log message
     * @param {any[]} args - Additional arguments
     * @returns {Array} Formatted log arguments
     */
    format(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${this.name}] [${level}]`;
        return [prefix, message, ...args];
    }

    /**
     * Log debug message
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    debug(message, ...args) {
        if (this.minLevel <= LogLevel.DEBUG) {
            console.debug(...this.format('DEBUG', message, ...args));
        }
    }

    /**
     * Log info message
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    info(message, ...args) {
        if (this.minLevel <= LogLevel.INFO) {
            console.info(...this.format('INFO', message, ...args));
        }
    }

    /**
     * Log warning message
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    warn(message, ...args) {
        if (this.minLevel <= LogLevel.WARN) {
            console.warn(...this.format('WARN', message, ...args));
        }
    }

    /**
     * Log error message
     * @param {string} message - Log message
     * @param {...any} args - Additional arguments
     */
    error(message, ...args) {
        if (this.minLevel <= LogLevel.ERROR) {
            // Handle Error objects and DOMException specially
            const formattedArgs = args.map(arg => {
                if (arg instanceof Error || arg instanceof DOMException) {
                    return {
                        name: arg.name,
                        message: arg.message,
                        code: arg.code,
                        stack: arg.stack
                    };
                }
                return arg;
            });
            console.error(...this.format('ERROR', message, ...formattedArgs));
        }
    }

    /**
     * Log error with full details
     * @param {string} message - Error message
     * @param {Error} error - Error object
     */
    errorWithDetails(message, error) {
        if (this.minLevel <= LogLevel.ERROR) {
            const details = {
                message: error.message,
                name: error.name,
                stack: error.stack,
                ...error
            };
            console.error(...this.format('ERROR', message, JSON.stringify(details, null, 2)));
        }
    }
}

/**
 * Create a logger instance
 * @param {string} name - Logger name
 * @param {number} minLevel - Minimum log level
 * @returns {Logger} Logger instance
 */
export function createLogger(name, minLevel = LogLevel.INFO) {
    return new Logger(name, minLevel);
}

/**
 * Default logger instance
 */
export const logger = new Logger('YouTubeWatchmarker', LogLevel.INFO);

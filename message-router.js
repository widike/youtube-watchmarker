/**
 * Message Router
 * Handles routing of messages between content scripts and background script
 */

import { logger } from './logger.js';
import { errorHandler, ExtensionError, ErrorUtils } from './error-handler.js';
import { ERRORS } from './constants.js';

/**
 * Message Router class
 * Routes messages to appropriate handlers with error handling
 */
export class MessageRouter {
    constructor() {
        this.handlers = new Map();
        this.logger = logger;
    }

    /**
     * Register a message handler
     * @param {string} action - Action name
     * @param {Function} handler - Handler function
     */
    register(action, handler) {
        if (this.handlers.has(action)) {
            this.logger.warn(`Handler for action "${action}" already exists, overwriting`);
        }
        this.handlers.set(action, handler);
        this.logger.debug(`Registered handler for action: ${action}`);
    }

    /**
     * Register multiple handlers at once
     * @param {Object} handlers - Object mapping actions to handlers
     */
    registerMultiple(handlers) {
        Object.entries(handlers).forEach(([action, handler]) => {
            this.register(action, handler);
        });
    }

    /**
     * Unregister a message handler
     * @param {string} action - Action name
     */
    unregister(action) {
        if (this.handlers.delete(action)) {
            this.logger.debug(`Unregistered handler for action: ${action}`);
        }
    }

    /**
     * Handle a message
     * @param {Object} message - Message object
     * @param {Object} sender - Message sender
     * @returns {Promise<Object>} Response object
     */
    async handle(message, sender) {
        const { action } = message;

        if (!action) {
            this.logger.warn('Received message without action', message);
            return ErrorUtils.createErrorResponse(
                new ExtensionError(ERRORS.INVALID_REQUEST, 'Message must include action field')
            );
        }

        const handler = this.handlers.get(action);
        if (!handler) {
            this.logger.warn(`No handler found for action: ${action}`);
            return ErrorUtils.createErrorResponse(
                new ExtensionError(ERRORS.UNKNOWN_ACTION, `Unknown action: ${action}`)
            );
        }

        try {
            this.logger.debug(`Handling action: ${action}`);
            const result = await handler(message, sender);

            // Handle null results
            if (result === null || result === undefined) {
                return { success: false, error: 'Handler returned null or undefined' };
            }

            // Ensure result has success field
            if (typeof result === 'object' && !('success' in result)) {
                return { success: true, ...result };
            }

            return result;
        } catch (error) {
            this.logger.error(`Error handling action "${action}":`, error);
            const errorEntry = errorHandler.handle(error, { action }, false);
            return ErrorUtils.createErrorResponse(error);
        }
    }

    /**
     * Setup Chrome message listeners
     * Automatically handles both chrome.runtime.onMessage and chrome.runtime.onConnect
     */
    setupListeners() {
        // Handle one-time messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handle(message, sender)
                .then(response => sendResponse(response))
                .catch(error => {
                    this.logger.error('Unhandled error in message handler:', error);
                    sendResponse(ErrorUtils.createErrorResponse(error));
                });

            // Return true to indicate async response
            return true;
        });

        // Handle long-lived connections
        chrome.runtime.onConnect.addListener((port) => {
            this.logger.debug(`Port connected: ${port.name}`);

            port.onMessage.addListener(async (message) => {
                try {
                    const response = await this.handle(message, { port });
                    if (port && !port.disconnected) {
                        port.postMessage(response);
                    }
                } catch (error) {
                    this.logger.error('Error handling port message:', error);
                    if (port && !port.disconnected) {
                        port.postMessage(ErrorUtils.createErrorResponse(error));
                    }
                }
            });

            port.onDisconnect.addListener(() => {
                this.logger.debug(`Port disconnected: ${port.name}`);
                if (chrome.runtime.lastError) {
                    this.logger.debug('Port disconnect reason:', chrome.runtime.lastError.message);
                }
            });
        });

        this.logger.info('Message router listeners initialized');
    }

    /**
     * Get all registered actions
     * @returns {string[]} List of registered action names
     */
    getRegisteredActions() {
        return Array.from(this.handlers.keys());
    }

    /**
     * Check if an action is registered
     * @param {string} action - Action name
     * @returns {boolean} True if registered
     */
    hasHandler(action) {
        return this.handlers.has(action);
    }

    /**
     * Clear all handlers
     */
    clear() {
        this.handlers.clear();
        this.logger.info('All message handlers cleared');
    }
}

/**
 * Create and export default message router instance
 */
export const messageRouter = new MessageRouter();

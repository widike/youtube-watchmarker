/**
 * Browser utilities for YouTube Watchmarker
 * Handles browser detection, messaging, and JSON parsing
 */

import { IMPORT_EXPORT, TIMEOUTS } from './constants.js';

/**
 * Detects the browser type
 * @returns {string|null} Browser type ('firefox', 'chrome', or null)
 */
export function getBrowserType() {
    if (typeof browser !== "undefined") {
        return "firefox";
    }
    if (typeof chrome !== "undefined") {
        return "chrome";
    }
    return null;
}

/**
 * Parses JSON with bracket counting for incomplete JSON strings
 * Used for parsing streaming JSON responses
 * @param {string} jsonString - The JSON string to parse
 * @returns {Object|null} Parsed JSON object or null if parsing fails
 */
export function parseIncompleteJson(jsonString) {
    let length = 1;
    let count = 0;

    for (; length < jsonString.length; length++) {
        if (jsonString[length - 1] === "{") {
            count++;
        } else if (jsonString[length - 1] === "}") {
            count--;
        }

        if (count === 0) {
            break;
        }
    }

    try {
        return JSON.parse(jsonString.substring(0, length));
    } catch (error) {
        console.warn("Failed to parse incomplete JSON:", error);
        return null;
    }
}

/**
 * Sends a message to a tab with retry logic
 * @param {number} tabId - The tab ID to send the message to
 * @param {Object} message - The message to send
 * @param {number} [retryCount] - Number of retry attempts (default from constants)
 */
export function sendMessageToTab(tabId, message, retryCount = IMPORT_EXPORT.MAX_RETRY_ATTEMPTS) {
    if (retryCount === 0) {
        console.warn(`Failed to send message to tab ${tabId} after all retries`);
        return;
    }

    chrome.tabs.sendMessage(tabId, message, {}, () => {
        if (chrome.runtime.lastError) {
            setTimeout(
                () => sendMessageToTab(tabId, message, retryCount - 1),
                TIMEOUTS.TAB_MESSAGE_RETRY
            );
        }
    });
}

/**
 * Creates a response callback function that handles null propagation
 * @param {Function} transformArgs - Function to transform non-null arguments
 * @param {Function} responseCallback - The callback function to be called
 * @returns {Function} A callback function
 */
export function createResponseCallback(transformArgs, responseCallback) {
    return (args) => {
        if (typeof responseCallback !== 'function') {
            return;
        }

        if (args === null) {
            responseCallback(null);
        } else {
            responseCallback(transformArgs(args));
        }
    };
}


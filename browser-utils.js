// @ts-check

/**
 * Browser utilities for YouTube Watchmarker
 * Handles extension tab messaging
 */

import { IMPORT_EXPORT, TIMEOUTS } from "./constants.js";

/**
 * Sends a message to a tab with retry logic
 * @param {number} tabId - The tab ID to send the message to
 * @param {Object} message - The message to send
 * @param {number} [retryCount] - Number of retry attempts (default from constants)
 */
export function sendMessageToTab(
  tabId,
  message,
  retryCount = IMPORT_EXPORT.MAX_RETRY_ATTEMPTS,
) {
  if (retryCount === 0) {
    console.warn(`Failed to send message to tab ${tabId} after all retries`);
    return;
  }

  chrome.tabs.sendMessage(tabId, message, {}, () => {
    if (chrome.runtime.lastError) {
      setTimeout(
        () => sendMessageToTab(tabId, message, retryCount - 1),
        TIMEOUTS.TAB_MESSAGE_RETRY,
      );
    }
  });
}

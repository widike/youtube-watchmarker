/**
 * Detects the browser type
 * @returns {string|null} Browser type ('firefox', 'chrome', or null)
 */
export const getBrowserType = () => {
    if (typeof browser !== "undefined") {
        return "firefox";
    }
    if (typeof chrome !== "undefined") {
        return "chrome";
    }
    return null;
};

/**
 * Parses JSON with hacky bracket counting for incomplete JSON strings
 * @param {string} jsonString - The JSON string to parse
 * @returns {Object|null} Parsed JSON object or null if parsing fails
 */
export const parseIncompleteJson = (jsonString) => {
    let length = 1;
    let count = 0;

    for (let i = 0; length < jsonString.length; length++) {
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
        return JSON.parse(jsonString.substr(0, length));
    } catch (error) {
        console.warn("Failed to parse incomplete JSON:", error);
        return null;
    }
};

/**
 * Sends a message to a tab with retry logic
 * @param {number} tabId - The tab ID to send the message to
 * @param {Object} message - The message to send
 * @param {number} [retryCount=100] - Number of retry attempts
 */
export const sendMessageToTab = (tabId, message, retryCount = 100) => {
    if (retryCount === 0) {
        console.warn(`Failed to send message to tab ${tabId} after all retries`);
        return;
    }

    chrome.tabs.sendMessage(tabId, message, {}, (response) => {
        if (chrome.runtime.lastError) {
            setTimeout(() => sendMessageToTab(tabId, message, retryCount - 1), 100);
        }
    });
};

/**
 * Creates a response callback function that handles null propagation
 * @param {Function} transformArgs - Function to transform non-null arguments
 * @param {Function} responseCallback - The callback function to be called
 * @returns {Function} A callback function
 */
export const createResponseCallback = (transformArgs, responseCallback) => {
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
};

/**
 * Gets a value from Chrome storage asynchronously using native promises
 * @param {string} key - Storage key
 * @returns {Promise<string|null>} The stored value or null if not found
 */
export const getStorageAsync = async (key) => {
    try {
        const result = await chrome.storage.local.get([key]);
        return result[key] || null;
    } catch (error) {
        throw new Error(`Failed to get ${key} from chrome.storage.local: ${error.message}`);
    }
};

/**
 * Gets multiple values from Chrome storage asynchronously
 * @param {string[]} keys - Array of storage keys
 * @returns {Promise<Object>} Object containing the stored values
 */
export const getMultipleStorageAsync = async (keys) => {
    try {
        return await chrome.storage.local.get(keys);
    } catch (error) {
        throw new Error(`Failed to get multiple keys from chrome.storage.local: ${error.message}`);
    }
};

/**
 * Gets all keys from Chrome storage (Chrome 130+)
 * @returns {Promise<string[]>} Array of all storage keys
 */
export const getStorageKeysAsync = async () => {
    try {
        return await chrome.storage.local.getKeys();
    } catch (error) {
        throw new Error(`Failed to get storage keys: ${error.message}`);
    }
};

/**
 * Sets a value in Chrome storage asynchronously using native promises
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 * @param {string} [errorMessage] - Custom error message
 * @returns {Promise<void>}
 */
export const setStorageAsync = async (key, value, errorMessage) => {
    try {
        await chrome.storage.local.set({
            [key]: value
        });
    } catch (error) {
        const errorMsg = errorMessage || `Failed to set ${key} in chrome.storage.local: ${error.message}`;
        throw new Error(errorMsg);
    }
};

/**
 * Sets multiple values in Chrome storage asynchronously
 * @param {Object} items - Object containing key-value pairs to store
 * @returns {Promise<void>}
 */
export const setMultipleStorageAsync = async (items) => {
    try {
        await chrome.storage.local.set(items);
    } catch (error) {
        throw new Error(`Failed to set multiple items in chrome.storage.local: ${error.message}`);
    }
};

/**
 * Removes a value from Chrome storage asynchronously
 * @param {string} key - Storage key to remove
 * @returns {Promise<void>}
 */
export const removeStorageAsync = async (key) => {
    try {
        await chrome.storage.local.remove([key]);
    } catch (error) {
        throw new Error(`Failed to remove ${key} from chrome.storage.local: ${error.message}`);
    }
};

/**
 * Removes multiple values from Chrome storage asynchronously
 * @param {string[]} keys - Array of storage keys to remove
 * @returns {Promise<void>}
 */
export const removeMultipleStorageAsync = async (keys) => {
    try {
        await chrome.storage.local.remove(keys);
    } catch (error) {
        throw new Error(`Failed to remove multiple keys from chrome.storage.local: ${error.message}`);
    }
};

/**
 * Clears all data from Chrome storage asynchronously
 * @returns {Promise<void>}
 */
export const clearStorageAsync = async () => {
    try {
        await chrome.storage.local.clear();
    } catch (error) {
        throw new Error(`Failed to clear chrome.storage.local: ${error.message}`);
    }
};

// Sync storage utilities
/**
 * Gets a value from Chrome sync storage asynchronously
 * @param {string} key - Storage key
 * @returns {Promise<any>} The stored value or undefined if not found
 */
export const getSyncStorageAsync = async (key) => {
    try {
        const result = await chrome.storage.sync.get([key]);
        return result[key];
    } catch (error) {
        throw new Error(`Failed to get ${key} from chrome.storage.sync: ${error.message}`);
    }
};

/**
 * Gets multiple values from Chrome sync storage asynchronously
 * @param {string[]} keys - Array of storage keys
 * @returns {Promise<Object>} Object containing the stored values
 */
export const getMultipleSyncStorageAsync = async (keys) => {
    try {
        return await chrome.storage.sync.get(keys);
    } catch (error) {
        throw new Error(`Failed to get multiple keys from chrome.storage.sync: ${error.message}`);
    }
};

/**
 * Gets all keys from Chrome sync storage (Chrome 130+)
 * @returns {Promise<string[]>} Array of all storage keys
 */
export const getSyncStorageKeysAsync = async () => {
    try {
        return await chrome.storage.sync.getKeys();
    } catch (error) {
        throw new Error(`Failed to get sync storage keys: ${error.message}`);
    }
};

/**
 * Sets a value in Chrome sync storage asynchronously
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @returns {Promise<void>}
 */
export const setSyncStorageAsync = async (key, value) => {
    try {
        await chrome.storage.sync.set({
            [key]: value
        });
    } catch (error) {
        throw new Error(`Failed to set ${key} in chrome.storage.sync: ${error.message}`);
    }
};

/**
 * Sets multiple values in Chrome sync storage asynchronously
 * @param {Object} items - Object containing key-value pairs to store
 * @returns {Promise<void>}
 */
export const setMultipleSyncStorageAsync = async (items) => {
    try {
        await chrome.storage.sync.set(items);
    } catch (error) {
        throw new Error(`Failed to set multiple items in chrome.storage.sync: ${error.message}`);
    }
};

/**
 * Sets a default value in storage if the key doesn't exist
 * @param {string} key - Storage key
 * @param {any} defaultValue - Default value to set
 * @returns {Promise<void>}
 */
export const setDefaultInStorageIfNull = async (key, defaultValue) => {
    try {
        const result = await chrome.storage.local.get([key]);
        if (result[key] === undefined) {
            await chrome.storage.local.set({
                [key]: defaultValue
            });
        }
    } catch (error) {
        throw new Error(`Failed to set default value for ${key}: ${error.message}`);
    }
};

/**
 * Sets a default value in sync storage if the key doesn't exist
 * @param {string} key - Storage key
 * @param {any} defaultValue - Default value to set
 * @returns {Promise<void>}
 */
export const setDefaultInSyncStorageIfNull = async (key, defaultValue) => {
    try {
        const result = await chrome.storage.sync.get([key]);
        if (result[key] === undefined) {
            await chrome.storage.sync.set({
                [key]: defaultValue
            });
        }
    } catch (error) {
        throw new Error(`Failed to set default sync value for ${key}: ${error.message}`);
    }
};

// AsyncSeries class has been removed - use async/await instead



/**
 * YouTube authentication utilities (simplified from BackgroundUtils)
 */

/**
 * Gets YouTube cookies
 * @returns {Promise<Object>} Object containing cookie values
 */
export async function getYouTubeCookies() {
    const cookieNames = ["SAPISID", "__Secure-3PAPISID"];
    const cookies = {};

    for (const cookieName of cookieNames) {
        const cookie = await chrome.cookies.get({
            url: "https://www.youtube.com",
            name: cookieName,
        });
        cookies[cookieName] = cookie ? cookie.value : null;
    }

    return cookies;
}

/**
 * Creates YouTube authentication header
 * @param {Object} cookies - Cookie object from getYouTubeCookies
 * @returns {Promise<string>} SAPISIDHASH authentication string
 */
export async function createYouTubeAuthHeader(cookies) {
    const time = Math.round(Date.now() / 1000);
    const cookie = cookies["SAPISID"] || cookies["__Secure-3PAPISID"];
    const origin = "https://www.youtube.com";

    const hash = await crypto.subtle.digest(
        "SHA-1",
        new TextEncoder().encode(`${time} ${cookie} ${origin}`)
    );

    const hashArray = Array.from(new Uint8Array(hash));
    const hashHex = hashArray
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

    return `SAPISIDHASH ${time}_${hashHex}`;
}

/**
 * Fixes UTF-8 double encoding issues in text strings
 * Converts Latin-1 misinterpreted UTF-8 back to proper UTF-8
 * @param {string} text - Text that may have UTF-8 double encoding issues
 * @returns {string} Properly decoded UTF-8 text
 */
export const fixUtf8DoubleEncoding = (text) => {
    if (!text || typeof text !== 'string') {
        return text;
    }

    try {
        // First, encode the string as Latin-1 to get the original UTF-8 bytes
        const latin1Bytes = new Uint8Array(text.length);
        for (let i = 0; i < text.length; i++) {
            latin1Bytes[i] = text.charCodeAt(i) & 0xFF;
        }

        // Then decode as UTF-8 using TextDecoder
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const decoded = decoder.decode(latin1Bytes);

        // Only return the decoded version if it's different and seems valid
        // (contains fewer replacement characters or obvious improvements)
        if (decoded !== text && decoded.length > 0) {
            // Check if the decoding actually improved the text
            // by looking for common UTF-8 double encoding patterns
            const commonPatterns = [
                'Ã¤', 'Ã¶', 'Ã¼', 'ÃŸ', // German umlauts
                'Ã¡', 'Ã©', 'Ã­', 'Ã³', 'Ãº', // Spanish accents
                'Ã ', 'Ã¨', 'Ã¬', 'Ã²', 'Ã¹', // More accents
                'Ã¢', 'Ãª', 'Ã®', 'Ã´', 'Ã»', // Circumflex accents
                'Ã£', 'Ã±', 'Ã§', // Other common UTF-8 patterns
                'â€™', 'â€œ', 'â€', // Smart quotes
                'â€¢', 'â€"', 'â€"' // Bullets and dashes
            ];

            const hasDoubleEncodingPatterns = commonPatterns.some(pattern => text.includes(pattern));
            const hasFewerReplacementChars = (decoded.match(/�/g) || []).length < (text.match(/�/g) || []).length;

            if (hasDoubleEncodingPatterns || hasFewerReplacementChars) {
                return decoded;
            }
        }

        return text;
    } catch (error) {
        console.warn('Failed to fix UTF-8 double encoding:', error);
        return text;
    }
};

/**
 * Enhanced HTML entity decoder that also handles UTF-8 double encoding
 * @param {string} text - Text to decode
 * @returns {string} Decoded text
 */
export const decodeHtmlEntitiesAndFixEncoding = (text) => {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // First fix UTF-8 double encoding
    let decoded = fixUtf8DoubleEncoding(text);

    // Then decode common HTML entities
    const entityMap = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' ',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
        '&euro;': '€',
        '&pound;': '£',
        '&yen;': '¥',
        '&cent;': '¢'
    };

    for (const [entity, char] of Object.entries(entityMap)) {
        decoded = decoded.replaceAll(entity, char);
    }

    // Handle numeric HTML entities
    decoded = decoded.replace(/&#(\d+);/g, (match, num) => {
        return String.fromCharCode(parseInt(num, 10));
    });

    decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });

    return decoded;
};

// Video title validation has been moved to validation.js
// Re-export for backward compatibility
export { isValidVideoTitle } from './validation.js';
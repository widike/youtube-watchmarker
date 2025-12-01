// @ts-check

/**
 * Storage utilities for YouTube Watchmarker
 * Unified API for Chrome storage (local and sync)
 */

/**
 * Storage API class
 * Provides unified interface for local and sync storage
 */
class StorageAPI {
    constructor(storageArea) {
        this.storage = storageArea;
    }

    /**
     * Get a single value from storage
     * @param {string} key - Storage key
     * @returns {Promise<any>} The stored value or undefined if not found
     */
    async get(key) {
        try {
            const result = await this.storage.get([key]);
            return result[key];
        } catch (error) {
            throw new Error(`Failed to get ${key} from storage: ${error.message}`);
        }
    }

    /**
     * Get multiple values from storage
     * @param {string[]} keys - Array of storage keys
     * @returns {Promise<Object>} Object containing the stored values
     */
    async getMultiple(keys) {
        try {
            return await this.storage.get(keys);
        } catch (error) {
            throw new Error(`Failed to get multiple keys from storage: ${error.message}`);
        }
    }

    /**
     * Get all keys from storage (Chrome 130+)
     * @returns {Promise<string[]>} Array of all storage keys
     */
    async getKeys() {
        try {
            return await this.storage.getKeys();
        } catch (error) {
            throw new Error(`Failed to get storage keys: ${error.message}`);
        }
    }

    /**
     * Set a single value in storage
     * @param {string} key - Storage key
     * @param {any} value - Value to store
     * @param {string} [errorMessage] - Custom error message
     * @returns {Promise<void>}
     */
    async set(key, value, errorMessage) {
        try {
            await this.storage.set({ [key]: value });
        } catch (error) {
            const errorMsg = errorMessage || `Failed to set ${key} in storage: ${error.message}`;
            throw new Error(errorMsg);
        }
    }

    /**
     * Set multiple values in storage
     * @param {Object} items - Object containing key-value pairs to store
     * @returns {Promise<void>}
     */
    async setMultiple(items) {
        try {
            await this.storage.set(items);
        } catch (error) {
            throw new Error(`Failed to set multiple items in storage: ${error.message}`);
        }
    }

    /**
     * Remove a single value from storage
     * @param {string} key - Storage key to remove
     * @returns {Promise<void>}
     */
    async remove(key) {
        try {
            await this.storage.remove([key]);
        } catch (error) {
            throw new Error(`Failed to remove ${key} from storage: ${error.message}`);
        }
    }

    /**
     * Remove multiple values from storage
     * @param {string[]} keys - Array of storage keys to remove
     * @returns {Promise<void>}
     */
    async removeMultiple(keys) {
        try {
            await this.storage.remove(keys);
        } catch (error) {
            throw new Error(`Failed to remove multiple keys from storage: ${error.message}`);
        }
    }

    /**
     * Clear all data from storage
     * @returns {Promise<void>}
     */
    async clear() {
        try {
            await this.storage.clear();
        } catch (error) {
            throw new Error(`Failed to clear storage: ${error.message}`);
        }
    }

    /**
     * Set a default value in storage if the key doesn't exist
     * @param {string} key - Storage key
     * @param {any} defaultValue - Default value to set
     * @returns {Promise<void>}
     */
    async setDefaultIfNull(key, defaultValue) {
        try {
            const result = await this.storage.get([key]);
            if (result[key] === undefined) {
                await this.storage.set({ [key]: defaultValue });
            }
        } catch (error) {
            throw new Error(`Failed to set default value for ${key}: ${error.message}`);
        }
    }
}

/**
 * Create a storage API instance
 * @param {string} type - Storage type ('local' or 'sync')
 * @returns {StorageAPI} Storage API instance
 */
export function createStorageAPI(type = 'local') {
    const storageArea = type === 'sync' ? chrome.storage.sync : chrome.storage.local;
    return new StorageAPI(storageArea);
}

/**
 * Pre-created instances for convenience
 * Use these for all storage operations throughout the codebase
 */
export const localStorage = createStorageAPI('local');
export const syncStorage = createStorageAPI('sync');

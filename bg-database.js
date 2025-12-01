import { databaseProviderFactory } from "./database-provider-factory.js";
import { credentialStorage } from "./credential-storage.js";
import { supabaseDatabaseProvider } from "./supabase-database-provider.js";
import { SyncManagerInstance } from "./bg-sync-manager.js";
import { DATABASE, ERRORS } from "./constants.js";
import { logger } from "./logger.js";

/**
 * Database management class for YouTube watch history
 * All methods now return Promises for modern async/await usage
 */
export class DatabaseManager {
    constructor() {
        this.database = null;
        this.DB_NAME = DATABASE.NAME;
        this.DB_VERSION = DATABASE.VERSION;
        this.STORE_NAME = DATABASE.STORE_NAME;
        this.isInitialized = false;
        this.syncManager = SyncManagerInstance;
        this.providerFactory = databaseProviderFactory;
    }

    /**
     * Initialize the database
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            return;
        }

        try {
            // Open database
            await this.openDatabaseAsync();

            // Notify providers that database is ready
            this.notifyProvidersReady();

            // Initialize sync manager
            await this.syncManager.init();

            this.isInitialized = true;
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error("Failed to initialize database:", error);
            throw error;
        }
    }

    /**
     * Notify providers that database is ready
     */
    notifyProvidersReady() {
        if (this.providerFactory && this.providerFactory.getCurrentProvider()) {
            const currentProvider = this.providerFactory.getCurrentProvider();
            if (currentProvider.updateConnectionStatus) {
                currentProvider.updateConnectionStatus();
            }
        }
    }

    /**
     * Opens the IndexedDB database
     * @returns {Promise<void>}
     */
    async openDatabaseAsync() {
        return new Promise((resolve, reject) => {
            const openRequest = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            openRequest.onupgradeneeded = () => {
                const db = openRequest.result;
                let store = null;

                if (db.objectStoreNames.contains(this.STORE_NAME)) {
                    store = openRequest.transaction.objectStore(this.STORE_NAME);
                } else {
                    store = db.createObjectStore(this.STORE_NAME, {
                        keyPath: DATABASE.INDEXES.IDENT,
                    });
                }

                // Create indexes if they don't exist
                if (!store.indexNames.contains(DATABASE.INDEXES.IDENT)) {
                    store.createIndex(DATABASE.INDEXES.IDENT, DATABASE.INDEXES.IDENT, { unique: true });
                }

                if (!store.indexNames.contains(DATABASE.INDEXES.TIMESTAMP)) {
                    store.createIndex(DATABASE.INDEXES.TIMESTAMP, DATABASE.INDEXES.TIMESTAMP, { unique: false });
                }

                // Remove old timestamp index if it exists (renamed to intTimestamp)
                if (store.indexNames.contains("longTimestamp")) {
                    store.deleteIndex("longTimestamp");
                }
            };

            openRequest.onerror = () => {
                logger.error("Failed to open database:", {
                    error: openRequest.error?.message || 'Unknown database error',
                    errorName: openRequest.error?.name || 'DatabaseError'
                });
                this.database = null;
                reject(new Error('Failed to open database'));
            };

            openRequest.onsuccess = () => {
                this.database = openRequest.result;
                resolve();
            };
        });
    }

    /**
     * Get object store for database operations
     * @param {string} mode - Transaction mode
     * @returns {IDBObjectStore} Object store
     */
    getObjectStore(mode = 'readwrite') {
        if (!this.database) {
            throw new Error(ERRORS.DATABASE_NOT_AVAILABLE);
        }

        const transaction = this.database.transaction([this.STORE_NAME], mode);
        return transaction.objectStore(this.STORE_NAME);
    }

    /**
     * Export database data
     * @returns {Promise<Object>} Export data with metadata
     */
    async export() {
        try {
            const provider = this.providerFactory.getCurrentProvider();
            if (!provider) {
                throw new Error(ERRORS.PROVIDER_NOT_FOUND);
            }

            const data = await provider.getAllVideos();
            return {
                version: this.DB_VERSION,
                timestamp: Date.now(),
                provider: this.providerFactory.getCurrentProviderType(),
                data: data
            };
        } catch (error) {
            logger.error("Failed to export data:", error);
            throw error;
        }
    }

    /**
     * Import database data
     * @param {Array} videos - Array of video records to import
     * @returns {Promise<Object>} Import result with count
     */
    async import(videos) {
        try {
            if (!videos || !Array.isArray(videos)) {
                throw new Error(ERRORS.INVALID_REQUEST);
            }

            const provider = this.providerFactory.getCurrentProvider();
            if (!provider) {
                throw new Error(ERRORS.PROVIDER_NOT_FOUND);
            }

            await provider.importVideos(videos);
            return { count: videos.length };
        } catch (error) {
            logger.error("Failed to import data:", error);
            throw error;
        }
    }

    /**
     * Reset database (clear all data)
     * @returns {Promise<void>}
     */
    async reset() {
        try {
            const provider = this.providerFactory.getCurrentProvider();
            if (!provider) {
                throw new Error(ERRORS.PROVIDER_NOT_FOUND);
            }

            await provider.clearAllVideos();
            logger.info('Database reset successfully');
        } catch (error) {
            logger.error("Failed to reset database:", error);
            throw error;
        }
    }

    /**
     * Enable sync
     * @param {string} provider - Provider type
     * @param {number} interval - Sync interval in milliseconds
     * @returns {Promise<void>}
     */
    async enableSync(provider, interval) {
        try {
            await this.syncManager.enableSync(provider, interval);
            logger.info('Sync enabled');
        } catch (error) {
            logger.error("Failed to enable sync:", error);
            throw error;
        }
    }

    /**
     * Disable sync
     * @returns {Promise<void>}
     */
    async disableSync() {
        try {
            await this.syncManager.disableSync();
            logger.info('Sync disabled');
        } catch (error) {
            logger.error("Failed to disable sync:", error);
            throw error;
        }
    }

    /**
     * Sync now
     * @returns {Promise<void>}
     */
    async syncNow() {
        try {
            await this.syncManager.syncNow();
            logger.info('Sync completed');
        } catch (error) {
            logger.error("Failed to sync:", error);
            throw error;
        }
    }

    /**
     * Get sync status
     * @returns {Promise<Object>} Sync status information
     */
    async getSyncStatus() {
        try {
            return await this.syncManager.getStatus();
        } catch (error) {
            logger.error("Failed to get sync status:", error);
            throw error;
        }
    }

    /**
     * Switch database provider
     * @param {string} provider - Provider name
     * @returns {Promise<boolean>} Success status
     */
    async switchProvider(provider) {
        try {
            const success = await this.providerFactory.switchProvider(provider);
            if (success) {
                logger.info(`Switched to ${provider} provider`);
            }
            return success;
        } catch (error) {
            logger.error("Failed to switch provider:", error);
            throw error;
        }
    }

    /**
     * Get provider status
     * @returns {Promise<Object>} Provider status information
     */
    async getProviderStatus() {
        try {
            return this.providerFactory.getProviderStatus();
        } catch (error) {
            logger.error("Failed to get provider status:", error);
            throw error;
        }
    }

    /**
     * Get available providers
     * @returns {Promise<Array>} List of available providers
     */
    async getAvailableProviders() {
        try {
            return this.providerFactory.getAvailableProviders();
        } catch (error) {
            logger.error("Failed to get available providers:", error);
            throw error;
        }
    }

    /**
     * Migrate data between providers
     * @param {string} fromProvider - Source provider
     * @param {string} toProvider - Target provider
     * @returns {Promise<boolean>} Success status
     */
    async migrateData(fromProvider, toProvider) {
        try {
            const success = await this.providerFactory.migrateData(fromProvider, toProvider);
            if (success) {
                logger.info(`Migrated data from ${fromProvider} to ${toProvider}`);
            }
            return success;
        } catch (error) {
            logger.error("Failed to migrate data:", error);
            throw error;
        }
    }

    /**
     * Configure Supabase
     * @param {string} url - Supabase URL
     * @param {string} apiKey - Supabase API key
     * @returns {Promise<void>}
     */
    async configureSupabase(url, apiKey) {
        try {
            await credentialStorage.storeCredentials({
                supabaseUrl: url,
                apiKey: apiKey
            });
            logger.info('Supabase configured successfully');
        } catch (error) {
            logger.error("Failed to configure Supabase:", error);
            throw error;
        }
    }

    /**
     * Test Supabase connection
     * @returns {Promise<boolean>} Connection test result
     */
    async testSupabase() {
        try {
            return await supabaseDatabaseProvider.testConnection();
        } catch (error) {
            logger.error("Failed to test Supabase:", error);
            throw error;
        }
    }

    /**
     * Check Supabase table existence
     * @returns {Promise<boolean>} Table existence status
     */
    async checkSupabaseTable() {
        try {
            return await supabaseDatabaseProvider.checkTableExists();
        } catch (error) {
            logger.error("Failed to check Supabase table:", error);
            throw error;
        }
    }

    /**
     * Clear Supabase credentials
     * @returns {Promise<void>}
     */
    async clearSupabase() {
        try {
            await credentialStorage.clearCredentials();
            logger.info('Supabase credentials cleared');
        } catch (error) {
            logger.error("Failed to clear Supabase credentials:", error);
            throw error;
        }
    }

    /**
     * Get Supabase credentials (masked)
     * @returns {Promise<Object>} Masked credentials
     */
    async getSupabaseCredentials() {
        try {
            return await credentialStorage.getMaskedCredentials();
        } catch (error) {
            logger.error("Failed to get Supabase credentials:", error);
            throw error;
        }
    }

    /**
     * Get Supabase status
     * @returns {Promise<Object>} Supabase status information
     */
    async getSupabaseStatus() {
        try {
            const hasCredentials = await credentialStorage.hasCredentials();
            const isConfigured = hasCredentials;
            let isConnected = false;

            if (isConfigured) {
                try {
                    isConnected = await supabaseDatabaseProvider.testConnection();
                } catch (error) {
                    logger.warn("Supabase connection test failed:", error);
                }
            }

            return {
                configured: isConfigured,
                connected: isConnected,
                hasCredentials: hasCredentials
            };
        } catch (error) {
            logger.error("Failed to get Supabase status:", error);
            throw error;
        }
    }
}

// Global instance
export const Database = new DatabaseManager();

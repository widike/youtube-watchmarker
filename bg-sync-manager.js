// @ts-check

import { databaseProviderFactory } from "./database-provider-factory.js";
import { logger } from "./logger.js";

/**
 * Sync manager for automatic synchronization between databases
 */
export class SyncManager {
    constructor() {
        this.isInitialized = false;
        this.syncInterval = null;
        this.syncIntervalMinutes = 60; // Default 1 hour
        this.isManualSyncInProgress = false;
        this.lastSyncTimestamp = 0;
        this.autoSyncEnabled = false;
    }

    /**
     * Initialize the sync manager
     * @returns {Promise<void>}
     */
    async init() {
        if (this.isInitialized) {
            return;
        }

        try {
            // Load configuration
            await this.loadConfigurationAsync();

            // Start auto sync if enabled
            if (this.autoSyncEnabled) {
                await this.startAutoSyncInternal();
            }

            // Set up storage change listener
            chrome.storage.onChanged.addListener(this.onStorageChanged.bind(this));

            this.isInitialized = true;
        } catch (error) {
            logger.error("Failed to initialize sync manager:", error);
            throw error;
        }
    }

    /**
     * Load configuration from storage (async version)
     */
    async loadConfigurationAsync() {
        try {
            const result = await chrome.storage.sync.get([
                'auto_sync_enabled',
                'sync_interval_minutes',
                'sync_last_timestamp'
            ]);

            this.autoSyncEnabled = result.auto_sync_enabled || false;
            this.syncIntervalMinutes = result.sync_interval_minutes || 60;
            this.lastSyncTimestamp = result.sync_last_timestamp || 0;
        } catch (error) {
            logger.error('Failed to load sync manager configuration:', error);
            throw error;
        }
    }

    /**
     * Start automatic synchronization
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async startAutoSync() {
        try {
            this.autoSyncEnabled = true;

            // Save configuration
            await chrome.storage.sync.set({ auto_sync_enabled: true });

            await this.startAutoSyncInternal();

            return { success: true };
        } catch (error) {
            logger.error("Failed to start auto sync:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Internal method to start auto sync
     */
    async startAutoSyncInternal() {
        // Clear existing interval
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        // Set up new interval
        const intervalMs = this.syncIntervalMinutes * 60 * 1000;
        this.syncInterval = setInterval(() => {
            this.performAutoSync();
        }, intervalMs);
    }

    /**
     * Stop automatic synchronization
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async stopAutoSync() {
        try {
            this.autoSyncEnabled = false;

            // Save configuration
            await chrome.storage.sync.set({ auto_sync_enabled: false });

            // Clear interval
            if (this.syncInterval) {
                clearInterval(this.syncInterval);
                this.syncInterval = null;
            }

            return { success: true };
        } catch (error) {
            logger.error("Failed to stop auto sync:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Perform synchronization now
     * @returns {Promise<{success: boolean, result?: any, error?: string}>}
     */
    async syncNow() {
        try {
            if (this.isManualSyncInProgress) {
                return { success: false, error: "Sync already in progress" };
            }

            this.isManualSyncInProgress = true;

            const result = await this.performSync();

            return { success: true, result };
        } catch (error) {
            logger.error("Failed to perform manual sync:", error);
            return { success: false, error: error.message };
        } finally {
            this.isManualSyncInProgress = false;
        }
    }

    /**
     * Update sync configuration
     */
    async updateConfiguration(request, response) {
        try {
            const { autoSyncEnabled, syncIntervalMinutes } = request;

            if (autoSyncEnabled !== undefined) {
                this.autoSyncEnabled = autoSyncEnabled;
            }

            if (syncIntervalMinutes !== undefined && syncIntervalMinutes > 0) {
                this.syncIntervalMinutes = syncIntervalMinutes;
            }

            // Save configuration (use consistent key names)
            await chrome.storage.sync.set({
                auto_sync_enabled: this.autoSyncEnabled,
                sync_interval_minutes: this.syncIntervalMinutes
            });

            // Restart auto sync if enabled
            if (this.autoSyncEnabled) {
                await this.startAutoSyncInternal();
            } else {
                if (this.syncInterval) {
                    clearInterval(this.syncInterval);
                    this.syncInterval = null;
                }
            }

            response({ success: true });
        } catch (error) {
            console.error("Failed to update sync configuration:", error);
            response({ success: false, error: error.message });
        }
    }

    /**
     * Get sync status
     * @returns {Promise<{success: boolean, status?: Object, error?: string}>}
     */
    async getStatus() {
        try {
            const status = {
                isInitialized: this.isInitialized,
                autoSyncEnabled: this.autoSyncEnabled,
                syncIntervalMinutes: this.syncIntervalMinutes,
                lastSyncTimestamp: this.lastSyncTimestamp,
                isManualSyncInProgress: this.isManualSyncInProgress,
                nextSyncTime: this.autoSyncEnabled && this.syncInterval ?
                    new Date(Date.now() + (this.syncIntervalMinutes * 60 * 1000)).toISOString() : null
            };

            return { success: true, status };
        } catch (error) {
            logger.error("Failed to get sync status:", error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Perform automatic synchronization
     */
    async performAutoSync() {
        try {
            if (this.isManualSyncInProgress) {
                console.log("Skipping auto sync - manual sync in progress");
                return;
            }

            await this.performSync();
        } catch (error) {
            console.error("Auto sync failed:", error);
        }
    }

    /**
     * Perform the actual synchronization using delta sync
     * This is more efficient than full bidirectional sync - only syncs changes since last sync
     */
    async performSync() {
        try {
            // Check if database provider factory is available
            if (!databaseProviderFactory) {
                throw new Error("Database provider factory not available");
            }

            // Check if auto-sync is enabled
            const settings = await chrome.storage.sync.get(['auto_sync_enabled']);
            if (!settings.auto_sync_enabled) {
                logger.debug("Auto-sync is disabled, skipping sync");
                return { success: true, synced: 0, message: "Auto-sync disabled" };
            }

            // Check if Supabase is enabled
            if (!databaseProviderFactory.isSupabaseEnabled()) {
                logger.debug("Supabase not enabled, skipping sync");
                return { success: true, synced: 0, message: "Supabase not enabled" };
            }

            logger.info("Starting delta sync to Supabase...");

            // Use delta sync instead of full bidirectional sync
            // This only syncs videos modified since last sync
            const syncResult = await databaseProviderFactory.performDeltaSync();

            if (syncResult.success) {
                // Update last sync timestamp
                this.lastSyncTimestamp = Date.now();
                await chrome.storage.sync.set({ sync_last_timestamp: this.lastSyncTimestamp });
                await this.updateSyncStats(true);

                logger.info(`Delta sync completed: ${syncResult.synced} videos synced`);
                return {
                    success: true,
                    synced: syncResult.synced,
                    message: `Synced ${syncResult.synced} videos to Supabase`
                };
            } else {
                await this.updateSyncStats(false);
                throw new Error(syncResult.error || "Delta sync failed");
            }
        } catch (error) {
            logger.error("Auto-sync failed:", error.message);
            await this.updateSyncStats(false);
            throw error;
        }
    }

    /**
     * Perform initial full sync from Supabase (for first-time setup)
     * @returns {Promise<Object>} Sync result
     */
    async performInitialSync() {
        try {
            if (!databaseProviderFactory.isSupabaseEnabled()) {
                return { success: false, error: "Supabase not enabled" };
            }

            logger.info("Starting initial sync from Supabase...");
            const result = await databaseProviderFactory.performInitialSync();

            if (result.success) {
                this.lastSyncTimestamp = Date.now();
                await chrome.storage.sync.set({ sync_last_timestamp: this.lastSyncTimestamp });
            }

            return result;
        } catch (error) {
            logger.error("Initial sync failed:", error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get sync statistics
     */
    async getSyncStats() {
        try {
            const result = await chrome.storage.sync.get([
                'sync_last_timestamp',
                'sync_success_count',
                'sync_error_count'
            ]);

            return {
                lastSyncTimestamp: result.sync_last_timestamp || 0,
                successCount: result.sync_success_count || 0,
                errorCount: result.sync_error_count || 0
            };
        } catch (error) {
            console.error("Failed to get sync stats:", error);
            return null;
        }
    }

    /**
     * Update sync statistics
     */
    async updateSyncStats(success) {
        try {
            const stats = await this.getSyncStats();
            if (stats) {
                if (success) {
                    stats.successCount++;
                } else {
                    stats.errorCount++;
                }

                await chrome.storage.sync.set({
                    sync_success_count: stats.successCount,
                    sync_error_count: stats.errorCount
                });
            }
        } catch (error) {
            console.error("Failed to update sync stats:", error);
        }
    }

    /**
     * Check if sync is needed based on last sync time
     */
    shouldSync() {
        if (!this.autoSyncEnabled) {
            return false;
        }

        const now = Date.now();
        const timeSinceLastSync = now - this.lastSyncTimestamp;
        const syncIntervalMs = this.syncIntervalMinutes * 60 * 1000;

        return timeSinceLastSync >= syncIntervalMs;
    }

    /**
     * Schedule next sync
     */
    scheduleNextSync() {
        if (this.autoSyncEnabled && !this.syncInterval) {
            this.startAutoSyncInternal();
        }
    }

    /**
     * Handle Chrome storage changes
     */
    onStorageChanged(changes, namespace) {
        if (namespace === 'sync') {
            // React to relevant storage changes
            if (changes.auto_sync_enabled) {
                const newValue = changes.auto_sync_enabled.newValue;
                if (newValue !== this.autoSyncEnabled) {
                    if (newValue) {
                        this.startAutoSync({}, () => { });
                    } else {
                        this.stopAutoSync({}, () => { });
                    }
                }
            }

            if (changes.sync_interval_minutes) {
                const newInterval = changes.sync_interval_minutes.newValue;
                if (newInterval && newInterval !== this.syncIntervalMinutes) {
                    this.syncIntervalMinutes = newInterval;
                    if (this.autoSyncEnabled) {
                        this.startAutoSyncInternal();
                    }
                }
            }
        }
    }

    /**
     * Get all sync-related storage keys (Chrome 130+)
     * Useful for debugging and comprehensive sync operations
     * @returns {Promise<string[]>} Array of sync-related storage keys
     */
    async getSyncRelatedKeys() {
        try {
            const allKeys = await chrome.storage.sync.getKeys();
            // Filter keys that are sync-related
            return allKeys.filter(key =>
                key.startsWith('sync_') ||
                key.includes('Timestamp') ||
                key.includes('_enabled') ||
                key.includes('supabase_')
            );
        } catch (error) {
            console.error('Failed to get sync-related keys:', error);
            return [];
        }
    }

    /**
     * Get comprehensive sync status including all relevant keys
     * @returns {Promise<Object>} Comprehensive sync status
     */
    async getComprehensiveSyncStatus() {
        try {
            const syncKeys = await this.getSyncRelatedKeys();
            const syncData = await chrome.storage.sync.get(syncKeys);

            return {
                keys: syncKeys,
                data: syncData,
                autoSyncEnabled: this.autoSyncEnabled,
                syncIntervalMinutes: this.syncIntervalMinutes,
                lastSyncTimestamp: this.lastSyncTimestamp,
                lastSyncDate: new Date(this.lastSyncTimestamp).toISOString()
            };
        } catch (error) {
            console.error('Failed to get comprehensive sync status:', error);
            return {
                keys: [],
                data: {},
                autoSyncEnabled: false,
                syncIntervalMinutes: 60,
                lastSyncTimestamp: 0,
                lastSyncDate: null
            };
        }
    }
}

// Create singleton instance
const syncManager = new SyncManager();

// Export the sync manager instance
export const SyncManagerInstance = syncManager;

// Make SyncManager available globally
globalThis.SyncManager = SyncManagerInstance;

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    SyncManagerInstance.onStorageChanged(changes, namespace);
});
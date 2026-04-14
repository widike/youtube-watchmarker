/**
 * Database Provider Factory
 * Manages database providers with IndexedDB as primary and Supabase as write-behind backup.
 *
 * Architecture:
 * - IndexedDB is ALWAYS the primary source of truth for reads
 * - Writes go to IndexedDB first (immediate), then queued for Supabase (async)
 * - This ensures the extension works offline and Supabase failures don't block operations
 */

import { supabaseDatabaseProvider } from "./supabase-database-provider.js";
import { credentialStorage } from "./credential-storage.js";
import { syncQueue, SyncOperationType } from "./sync-queue.js";
import { logger } from "./logger.js";
import { IndexedDBProvider } from "./indexeddb-provider.js";
import {
  performDeltaSync as performDeltaSyncUtil,
  performInitialSync as performInitialSyncUtil,
  mergeVideoData,
  DELTA_SYNC_STORAGE_KEY,
} from "./provider-sync.js";

/**
 * Database Provider Factory
 * Manages different database providers with IndexedDB-first architecture.
 *
 * NEW ARCHITECTURE (simplified):
 * - IndexedDB is ALWAYS the primary provider for reads
 * - Writes go to IndexedDB first, then queued for Supabase
 * - Supabase sync happens asynchronously via syncQueue
 * - This provides offline resilience and prevents Supabase failures from blocking operations
 */
export class DatabaseProviderFactory {
  constructor() {
    this.currentProvider = null;
    this.providerType = null;
    this.indexedDBProvider = null;
    this.databaseManager = null;

    // Supabase is now a secondary backup, not a primary provider
    this.supabaseEnabled = false;
    this.lastDeltaSyncTimestamp = 0;
    this.deltaSyncStorageKey = DELTA_SYNC_STORAGE_KEY;
  }

  /**
   * Set the database manager instance
   * @param {Object} databaseManager - Database manager instance
   */
  setDatabaseManager(databaseManager) {
    this.databaseManager = databaseManager;
    this.indexedDBProvider = new IndexedDBProvider(databaseManager);
  }

  /**
   * Get the current active provider
   * IndexedDB is always the primary provider for reads
   * @returns {Object} Current provider instance
   */
  getCurrentProvider() {
    // Always return IndexedDB as the primary provider
    // This ensures reads always work, even when Supabase is unavailable
    return this.indexedDBProvider || this.currentProvider;
  }

  /**
   * Get the current provider type
   * @returns {string} Provider type ('indexeddb' or 'supabase')
   */
  getCurrentProviderType() {
    return this.providerType;
  }

  /**
   * Check if Supabase sync is enabled
   * @returns {boolean} True if Supabase is configured and enabled
   */
  isSupabaseEnabled() {
    return this.supabaseEnabled && supabaseDatabaseProvider.isConnected;
  }

  /**
   * Write a video to IndexedDB and queue for Supabase sync
   * This is the preferred method for writes - ensures local-first operation
   * @param {Object} video - Video data to write
   * @returns {Promise<boolean>} Success status
   */
  async writeVideo(video) {
    // 1. Always write to IndexedDB first (fast, reliable, local)
    await this.indexedDBProvider.putVideo(video);

    // 2. Queue for Supabase sync (async, non-blocking)
    if (this.supabaseEnabled && supabaseDatabaseProvider.isConnected) {
      try {
        await syncQueue.enqueue(SyncOperationType.PUT_VIDEO, video);
      } catch (error) {
        // Log but don't fail - local write succeeded
        logger.warn("Failed to queue video for Supabase sync:", error.message);
      }
    }

    return true;
  }

  /**
   * Delete a video from IndexedDB and queue deletion for Supabase
   * @param {string} videoId - Video ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteVideo(videoId) {
    // 1. Delete from IndexedDB first
    await this.indexedDBProvider.deleteVideo(videoId);

    // 2. Queue for Supabase deletion
    if (this.supabaseEnabled && supabaseDatabaseProvider.isConnected) {
      try {
        await syncQueue.enqueue(SyncOperationType.DELETE_VIDEO, {
          strIdent: videoId,
        });
      } catch (error) {
        logger.warn(
          "Failed to queue video deletion for Supabase:",
          error.message,
        );
      }
    }

    return true;
  }

  /**
   * Perform delta sync - only sync videos modified since last sync
   * Much more efficient than full sync for large databases
   * @returns {Promise<Object>} Sync result with stats
   */
  async performDeltaSync() {
    if (!this.supabaseEnabled || !supabaseDatabaseProvider.isConnected) {
      return { success: false, error: "Supabase not available" };
    }
    return performDeltaSyncUtil(
      this.indexedDBProvider,
      supabaseDatabaseProvider,
    );
  }

  /**
   * Perform initial full sync from Supabase to IndexedDB
   * Used when setting up Supabase for the first time
   * @returns {Promise<Object>} Sync result
   */
  async performInitialSync() {
    if (!supabaseDatabaseProvider.isConnected) {
      return { success: false, error: "Supabase not connected" };
    }
    return performInitialSyncUtil(
      this.indexedDBProvider,
      supabaseDatabaseProvider,
    );
  }

  /**
   * Switch to IndexedDB provider
   * @param {boolean} savePreference - Whether to save this as user preference (default: true)
   * @returns {Promise<boolean>} Success status
   */
  async switchToIndexedDB(savePreference = true) {
    try {
      // Close current provider if different
      if (this.currentProvider && this.providerType !== "indexeddb") {
        await this.currentProvider.close();
      }

      // Initialize IndexedDB provider
      const success = await this.indexedDBProvider.init();
      if (!success) {
        throw new Error("Failed to initialize IndexedDB provider");
      }

      this.currentProvider = this.indexedDBProvider;
      this.providerType = "indexeddb";

      // Store provider preference only if requested
      if (savePreference) {
        await chrome.storage.local.set({
          database_provider: "indexeddb",
        });
      }

      return true;
    } catch (error) {
      console.error(
        "Failed to switch to IndexedDB:",
        JSON.stringify(
          {
            error: error.message,
            errorName: error.name,
            errorStack: error.stack,
          },
          null,
          2,
        ),
      );
      throw error;
    }
  }

  /**
   * Enable Supabase as a backup sync destination
   * NOTE: IndexedDB remains the primary provider for reads/writes
   * Supabase is used for write-behind sync (backup)
   * @returns {Promise<boolean>} Success status
   */
  async switchToSupabase() {
    try {
      // Check if credentials are available
      const hasCredentials = await credentialStorage.hasCredentials();

      if (!hasCredentials) {
        throw new Error(
          'No Supabase credentials found. Please configure Supabase credentials first using the "Save Configuration" button.',
        );
      }

      // Ensure IndexedDB is initialized as the primary provider
      if (!this.indexedDBProvider || !this.indexedDBProvider.isConnected) {
        await this.switchToIndexedDB(false);
      }

      // Initialize Supabase provider with retry logic
      let initAttempts = 0;
      const maxInitAttempts = 3;
      let success = false;
      let lastError = null;

      while (initAttempts < maxInitAttempts && !success) {
        try {
          initAttempts++;
          success = await supabaseDatabaseProvider.init();

          if (!success) {
            throw new Error("Supabase provider initialization returned false");
          }

          break;
        } catch (error) {
          lastError = error;

          if (initAttempts < maxInitAttempts) {
            // Wait before retrying (exponential backoff)
            const delay = Math.pow(2, initAttempts) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        const errorMessage =
          lastError?.message || "Unknown initialization error";
        throw new Error(
          `Failed to initialize Supabase provider after ${maxInitAttempts} attempts: ${errorMessage}`,
        );
      }

      // Test the connection
      const connectionTest = await supabaseDatabaseProvider.testConnection();

      if (!connectionTest) {
        throw new Error(
          "Supabase connection test failed. Please verify your credentials and network connectivity.",
        );
      }

      // Enable Supabase as backup (IndexedDB remains primary)
      this.supabaseEnabled = true;
      this.providerType = "supabase"; // For UI display purposes

      // Initialize sync queue with Supabase provider
      await syncQueue.init(supabaseDatabaseProvider);

      // Store provider preference
      await chrome.storage.local.set({
        database_provider: "supabase",
      });

      logger.info("Supabase enabled as backup sync destination");
      return true;
    } catch (error) {
      logger.error("Failed to enable Supabase:", error.message);

      // Disable Supabase sync on failure
      this.supabaseEnabled = false;

      // Ensure IndexedDB is still working as primary
      if (!this.indexedDBProvider || !this.indexedDBProvider.isConnected) {
        try {
          await this.switchToIndexedDB(false);
        } catch (fallbackError) {
          logger.error(
            "IndexedDB fallback also failed:",
            fallbackError.message,
          );
        }
      }

      throw error;
    }
  }

  /**
   * Disable Supabase sync (use IndexedDB only)
   * @returns {Promise<boolean>} Success status
   */
  async disableSupabase() {
    this.supabaseEnabled = false;
    this.providerType = "indexeddb";

    // Stop sync queue
    syncQueue.stopAutoSync();

    await chrome.storage.local.set({
      database_provider: "indexeddb",
    });

    logger.info("Supabase sync disabled, using IndexedDB only");
    return true;
  }

  /**
   * Initialize the factory and set up the default provider
   * @returns {Promise<boolean>} Success status
   */
  async init() {
    try {
      // Load saved provider preference
      const result = await chrome.storage.local.get(["database_provider"]);
      const savedProvider = result.database_provider || "indexeddb";

      // Try to initialize the saved provider
      if (savedProvider === "supabase") {
        try {
          const success = await this.switchToSupabase();
          if (success) {
            return true;
          }
        } catch (_error) {
          // Supabase initialization failed, falling back to IndexedDB
        }

        // Fall back to IndexedDB if Supabase fails, but don't save preference
        return await this.switchToIndexedDB(false);
      }

      // Default to IndexedDB (save preference since this is the default)
      return await this.switchToIndexedDB(true);
    } catch (error) {
      console.error(
        "Failed to initialize database factory:",
        JSON.stringify(
          {
            error: error.message,
            errorName: error.name,
            errorStack: error.stack,
          },
          null,
          2,
        ),
      );

      // Emergency fallback to IndexedDB
      try {
        return await this.switchToIndexedDB(false); // Don't save preference during emergency fallback
      } catch (fallbackError) {
        console.error(
          "Emergency fallback failed:",
          JSON.stringify(
            {
              error: fallbackError.message,
              errorName: fallbackError.name,
              errorStack: fallbackError.stack,
            },
            null,
            2,
          ),
        );
        return false;
      }
    }
  }

  /**
   * Get available providers
   * @returns {Array} List of available providers
   */
  async getAvailableProviders() {
    const providers = [
      {
        id: "indexeddb",
        name: "Local Storage (IndexedDB)",
        description: "Store data locally in your browser",
        isAvailable: true,
        isRemote: false,
      },
    ];

    // Check if Supabase is available
    const hasSupabaseCredentials = await credentialStorage.hasCredentials();
    providers.push({
      id: "supabase",
      name: "Supabase (PostgreSQL)",
      description: "Store data in Supabase cloud database",
      isAvailable: hasSupabaseCredentials,
      isRemote: true,
    });

    return providers;
  }

  /**
   * Get current provider status
   * @returns {Object} Provider status information
   */
  getProviderStatus() {
    const indexedDBStatus = this.indexedDBProvider
      ? {
          isConnected: this.indexedDBProvider.isConnected,
          isInitialized: this.indexedDBProvider.isInitialized,
        }
      : null;

    const supabaseStatus = supabaseDatabaseProvider
      ? {
          isConnected: supabaseDatabaseProvider.isConnected,
          isInitialized: supabaseDatabaseProvider.isInitialized,
          circuitBreaker: supabaseDatabaseProvider.getCircuitBreakerStatus(),
        }
      : null;

    return {
      // Architecture info
      architecture: "indexeddb-first",
      primaryProvider: "indexeddb",

      // UI display type (what user selected)
      type: this.providerType,

      // IndexedDB (always primary)
      indexedDB: indexedDBStatus,

      // Supabase (backup sync)
      supabaseEnabled: this.supabaseEnabled,
      supabase: supabaseStatus,

      // Sync queue status
      syncQueue: syncQueue.getStatus(),

      // Legacy compatibility
      isConnected: indexedDBStatus?.isConnected || false,
      isInitialized: indexedDBStatus?.isInitialized || false,
      info: this.indexedDBProvider?.getProviderInfo() || null,
    };
  }

  /**
   * Switch to a specific provider
   * @param {string} provider - Provider type ('indexeddb' or 'supabase')
   * @returns {Promise<boolean>} Success status
   */
  async switchProvider(provider) {
    if (!provider || !["indexeddb", "supabase"].includes(provider)) {
      throw new Error(
        'Invalid provider type. Must be "indexeddb" or "supabase"',
      );
    }

    if (provider === "indexeddb") {
      return await this.switchToIndexedDB();
    } else if (provider === "supabase") {
      return await this.switchToSupabase();
    }
  }

  /**
   * Migrate data from one provider to another
   * @param {string} sourceProvider - Source provider type
   * @param {string} targetProvider - Target provider type
   * @returns {Promise<boolean>} Success status
   */
  async migrateData(sourceProvider, targetProvider) {
    try {
      if (sourceProvider === targetProvider) {
        console.log(
          "Source and target providers are the same, no migration needed",
        );
        return true;
      }

      console.log(
        `Migrating data from ${sourceProvider} to ${targetProvider}...`,
      );

      // Get source provider instance
      let sourceProviderInstance;
      if (sourceProvider === "indexeddb") {
        sourceProviderInstance = this.indexedDBProvider;
        await sourceProviderInstance.init();
      } else if (sourceProvider === "supabase") {
        sourceProviderInstance = supabaseDatabaseProvider;
        await sourceProviderInstance.init();
      } else {
        throw new Error(`Unknown source provider: ${sourceProvider}`);
      }

      // Get target provider instance
      let targetProviderInstance;
      if (targetProvider === "indexeddb") {
        targetProviderInstance = this.indexedDBProvider;
        await targetProviderInstance.init();
      } else if (targetProvider === "supabase") {
        targetProviderInstance = supabaseDatabaseProvider;
        await targetProviderInstance.init();
      } else {
        throw new Error(`Unknown target provider: ${targetProvider}`);
      }

      // Get all data from source
      const sourceData = await sourceProviderInstance.getAllVideos();
      console.log(`Found ${sourceData.length} videos to migrate`);

      if (sourceData.length === 0) {
        console.log("No data to migrate");
        return true;
      }

      // Import data to target
      await targetProviderInstance.importVideos(sourceData);

      console.log(
        `Successfully migrated ${sourceData.length} videos from ${sourceProvider} to ${targetProvider}`,
      );
      return true;
    } catch (error) {
      console.error(
        "Data migration failed:",
        JSON.stringify(
          {
            error: error.message,
            errorName: error.name,
            errorStack: error.stack,
          },
          null,
          2,
        ),
      );
      throw error;
    }
  }

  /**
   * Sync data between two providers (bidirectional merge)
   * @param {string} provider1 - First provider type
   * @param {string} provider2 - Second provider type
   * @returns {Promise<boolean>} Success status
   */
  async syncProviders(provider1, provider2) {
    try {
      if (provider1 === provider2) {
        console.log("Providers are the same, no sync needed");
        return true;
      }

      // Get both providers
      const providers = {};

      for (const providerType of [provider1, provider2]) {
        if (providerType === "indexeddb") {
          providers[providerType] = this.indexedDBProvider;
          await providers[providerType].init();
        } else if (providerType === "supabase") {
          providers[providerType] = supabaseDatabaseProvider;
          await providers[providerType].init();
        } else {
          throw new Error(`Unknown provider: ${providerType}`);
        }
      }

      // Get all data from both providers
      const data1 = await providers[provider1].getAllVideos();
      const data2 = await providers[provider2].getAllVideos();

      // Merge data (keep the most recent timestamp for each video)
      const mergedData = mergeVideoData(data1, data2);

      // Update both providers with merged data
      await providers[provider1].importVideos(mergedData);
      await providers[provider2].importVideos(mergedData);

      return true;
    } catch (error) {
      console.error(
        "Data sync failed:",
        JSON.stringify(
          {
            error: error.message,
            errorName: error.name,
            errorStack: error.stack,
          },
          null,
          2,
        ),
      );
      throw error;
    }
  }
}

// Create singleton instance
export const databaseProviderFactory = new DatabaseProviderFactory();

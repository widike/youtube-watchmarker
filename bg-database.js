import { upgradeHistoryStorage } from "./history-storage.js";
import { databaseProviderFactory } from "./database-provider-factory.js";
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
      logger.info("Database initialized successfully");
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

        upgradeHistoryStorage(db, openRequest.transaction);

        // Create indexes if they don't exist
        if (!store.indexNames.contains(DATABASE.INDEXES.IDENT)) {
          store.createIndex(DATABASE.INDEXES.IDENT, DATABASE.INDEXES.IDENT, {
            unique: true,
          });
        }

        if (!store.indexNames.contains(DATABASE.INDEXES.TIMESTAMP)) {
          store.createIndex(
            DATABASE.INDEXES.TIMESTAMP,
            DATABASE.INDEXES.TIMESTAMP,
            { unique: false },
          );
        }

        // Remove old timestamp index if it exists (renamed to intTimestamp)
        if (store.indexNames.contains("longTimestamp")) {
          store.deleteIndex("longTimestamp");
        }
      };

      openRequest.onerror = () => {
        logger.error("Failed to open database:", {
          error: openRequest.error?.message || "Unknown database error",
          errorName: openRequest.error?.name || "DatabaseError",
        });
        this.database = null;
        reject(new Error("Failed to open database"));
      };

      openRequest.onsuccess = () => {
        this.database = openRequest.result;
        this.database.onversionchange = () => {
          this.database.close();
          this.database = null;
          this.isInitialized = false;
        };
        resolve();
      };
    });
  }

  /**
   * Get object store for database operations
   * @param {string} mode - Transaction mode
   * @returns {IDBObjectStore} Object store
   */
  getObjectStore(mode = "readwrite") {
    if (!this.database) {
      throw new Error(ERRORS.DATABASE_NOT_AVAILABLE);
    }

    const transaction = this.database.transaction([this.STORE_NAME], mode);
    return transaction.objectStore(this.STORE_NAME);
  }

  /**
   * Export database data
   * @returns {Promise<Array>} Exported video records
   */
  async export() {
    try {
      const provider = this.providerFactory.getCurrentProvider();
      if (!provider) {
        throw new Error(ERRORS.PROVIDER_NOT_FOUND);
      }

      return await provider.getAllVideos({ includeDeleted: true });
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
}

export const Database = new DatabaseManager();

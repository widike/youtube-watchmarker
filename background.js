// @ts-check

/**
 * Background Service Worker
 * Main entry point for the YouTube Watchmarker extension
 * Fully modernized with async/await patterns
 */

"use strict";

// Ensure Firefox compatibility before any imports use chrome.* promises
import "./polyfill.js";

// Core modules
import { logger } from "./logger.js";
import { messageRouter } from "./message-router.js";
import { settingsManager } from "./settings-manager.js";
import { alarmManager } from "./alarm-manager.js";
import { videoTracker } from "./video-tracker.js";

// Database modules
import { Database } from "./bg-database.js";
import { History } from "./bg-history.js";
import { Youtube } from "./bg-youtube.js";
import { Search } from "./bg-search.js";
import { SyncManagerInstance } from "./bg-sync-manager.js";
import { databaseProviderFactory } from "./database-provider-factory.js";

// Handler modules
import {
    handleDatabaseExport,
    handleDatabaseImport,
    handleDatabaseReset,
    handleDatabaseSize
} from "./handlers/database-handlers.js";
import {
    handleYoutubeLookup,
    handleYoutubeEnsure,
    handleYoutubeSynchronize,
    handleYoutubeLikedVideos,
    handleYoutubeMark
} from "./handlers/youtube-handlers.js";
import {
    handleSearchVideos,
    handleSearchDelete
} from "./handlers/search-handlers.js";
import {
    handleProviderStatus,
    handleProviderSwitch,
    handleProviderList,
    handleProviderMigrate,
    handleProviderSync,
    handleSupabaseConfigure,
    handleSupabaseTest,
    handleSupabaseClear,
    handleSupabaseGetCredentials,
    handleSupabaseGetStatus,
    handleSupabaseCheckTable
} from "./handlers/provider-handlers.js";
import {
    handleHistorySynchronize
} from "./handlers/history-handlers.js";
import {
    handleGetSetting,
    handleSetSetting
} from "./handlers/settings-handlers.js";

/**
 * Extension Manager
 * Coordinates initialization and lifecycle of all extension components
 */
class ExtensionManager {
    constructor() {
        this.isInitialized = false;
        this.providerFactory = databaseProviderFactory;

        // Setup cleanup on service worker shutdown
        self.addEventListener('beforeunload', () => this.cleanup());

        // Start initialization
        this.initialize().catch(error => {
            logger.error('Failed to initialize extension:', error);
        });
    }

    /**
     * Initialize the extension
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            logger.info('Initializing YouTube Watchmarker extension...');

            // Phase 1: Initialize settings
            await settingsManager.initialize();

            // Phase 2: Initialize database
            await this.initializeDatabase();
            await this.initializeProviderFactory();

            // Phase 3: Initialize other modules
            await this.initializeModules();

            // Phase 4: Setup message handlers
            this.registerMessageHandlers();

            // Phase 5: Setup alarms and video tracking
            await alarmManager.initialize();
            this.registerAlarmHandlers();

            await videoTracker.initialize(Youtube);

            // Phase 6: Setup action handler for icon clicks
            this.setupActionHandler();

            this.isInitialized = true;
            logger.info('Extension initialized successfully');

            // Perform startup sync
            await this.performStartupSync();
        } catch (error) {
            logger.error('Extension initialization failed:', error);
            throw error;
        }
    }

    /**
     * Initialize database
     */
    async initializeDatabase() {
        await Database.init();
        globalThis.Database = Database;
    }

    /**
     * Initialize provider factory
     */
    async initializeProviderFactory() {
        this.providerFactory.setDatabaseManager(Database);
        Database.providerFactory = this.providerFactory;

        const success = await this.providerFactory.init();
        if (!success) {
            throw new Error('Failed to initialize database provider factory');
        }
    }

    /**
     * Initialize other modules
     */
    async initializeModules() {
        await Promise.all([
            History.init(),
            Youtube.init(),
            Search.init()
        ]);

        logger.info('All modules initialized');
    }

    /**
     * Register all message handlers
     */
    registerMessageHandlers() {
        // Register all handlers using registerMultiple for cleaner code
        messageRouter.registerMultiple({
            // Database handlers
            'database-export': handleDatabaseExport,
            'database-import': handleDatabaseImport,
            'database-reset': handleDatabaseReset,
            'database-size': handleDatabaseSize,

            // YouTube handlers
            'youtube-lookup': handleYoutubeLookup,
            'youtube-ensure': handleYoutubeEnsure,
            'youtube-mark': handleYoutubeMark,
            'youtube-synchronize': handleYoutubeSynchronize,
            'youtube-liked-videos': handleYoutubeLikedVideos,

            // Search handlers
            'search-videos': handleSearchVideos,
            'search-delete': handleSearchDelete,

            // History handlers
            'history-synchronize': handleHistorySynchronize,

            // Provider handlers
            'database-provider-status': handleProviderStatus,
            'database-provider-switch': handleProviderSwitch,
            'database-provider-list': handleProviderList,
            'database-provider-migrate': handleProviderMigrate,
            'database-provider-sync': handleProviderSync,

            // Supabase handlers
            'supabase-configure': handleSupabaseConfigure,
            'supabase-test': handleSupabaseTest,
            'supabase-clear': handleSupabaseClear,
            'supabase-get-credentials': handleSupabaseGetCredentials,
            'supabase-get-status': handleSupabaseGetStatus,
            'supabase-check-table': handleSupabaseCheckTable,

            // Settings handlers
            'get-setting': handleGetSetting,
            'set-setting': handleSetSetting,

            // Sync manager handlers
            'sync-manager-start': (req) => this.handleSyncManagerStart(req),
            'sync-manager-stop': (req) => this.handleSyncManagerStop(req),
            'sync-manager-sync-now': (req) => this.handleSyncManagerSyncNow(req),
            'sync-manager-status': (req) => this.handleSyncManagerStatus(req)
        });

        // Setup listeners
        messageRouter.setupListeners();

        logger.info('All message handlers registered');
    }

    /**
     * Register alarm handlers
     */
    registerAlarmHandlers() {
        alarmManager.registerHandler('synchronize', async () => {
            await this.performPeriodicSync();
        });

        alarmManager.registerHandler('keep-alive', async () => {
            logger.debug('Keep-alive ping:', new Date().toISOString());
            await chrome.storage.local.set({ lastKeepAlive: Date.now() });
        });
    }

    /**
     * Setup action handler for extension icon clicks
     */
    setupActionHandler() {
        chrome.action.onClicked.addListener(() => {
            chrome.tabs.create({ url: "content/index.html" });
        });
    }

    /**
     * Perform startup synchronization
     */
    async performStartupSync() {
        logger.info('Starting startup synchronization...');

        try {
            const result = await chrome.storage.sync.get(['idCondition_Youhist']);
            const shouldSyncYoutube = result.idCondition_Youhist === true;

            if (shouldSyncYoutube) {
                logger.info('Syncing YouTube history on startup');
                await this.syncYoutube();
            } else {
                logger.info('YouTube history sync disabled');
            }

            logger.info('Startup synchronization completed');
        } catch (error) {
            logger.error('Error during startup synchronization:', error);
        }
    }

    /**
     * Perform periodic synchronization
     */
    async performPeriodicSync() {
        logger.info('Starting periodic synchronization...');

        try {
            const result = await chrome.storage.sync.get(['idCondition_Browhist', 'idCondition_Youhist']);
            const shouldSyncHistory = result.idCondition_Browhist === true;
            const shouldSyncYoutube = result.idCondition_Youhist === true;

            if (shouldSyncHistory) {
                logger.info('Syncing browser history');
                await this.syncHistory();
            }

            if (shouldSyncYoutube) {
                logger.info('Syncing YouTube history');
                await this.syncYoutube();
            }

            logger.info('Periodic synchronization completed');
        } catch (error) {
            logger.error('Error during periodic synchronization:', error);
        }
    }

    /**
     * Sync browser history
     */
    async syncHistory() {
        try {
            const result = await History.synchronize(
                0,
                true,
                (progress) => logger.debug('History sync progress:', progress)
            );
            logger.info('History sync completed:', result);
            return result;
        } catch (error) {
            logger.error('History synchronization failed:', error);
            throw error;
        }
    }

    /**
     * Sync YouTube history
     */
    async syncYoutube() {
        try {
            const result = await Youtube.synchronize(
                (progress) => logger.debug('YouTube sync progress:', progress)
            );
            logger.info('YouTube sync completed:', result);
            return result;
        } catch (error) {
            logger.error('YouTube synchronization failed:', error);
            throw error;
        }
    }

    /**
     * Sync manager handlers
     */
    async handleSyncManagerStart() {
        return await SyncManagerInstance.startAutoSync();
    }

    async handleSyncManagerStop() {
        return await SyncManagerInstance.stopAutoSync();
    }

    async handleSyncManagerSyncNow() {
        return await SyncManagerInstance.syncNow();
    }

    async handleSyncManagerStatus() {
        return await SyncManagerInstance.getStatus();
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        try {
            const currentProvider = this.providerFactory.getCurrentProvider();
            if (currentProvider && typeof currentProvider.cleanup === 'function') {
                currentProvider.cleanup();
            }
            logger.info('Extension cleanup completed');
        } catch (error) {
            logger.error('Error during cleanup:', error);
        }
    }
}

// Initialize the extension manager
const extensionManager = new ExtensionManager();

// Make available globally
globalThis.extensionManager = extensionManager;

// Listen for service worker startup to reinitialize
chrome.runtime.onStartup.addListener(() => {
    logger.info('Service worker restarted - reinitializing...');
    extensionManager.initialize().catch(error => {
        logger.error('Reinitialization failed:', error);
    });
});

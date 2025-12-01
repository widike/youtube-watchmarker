/**
 * Background Service Worker
 * Main entry point for the YouTube Watchmarker extension
 * Refactored to use modular architecture with message router
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
    handleYoutubeLikedVideos
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

import { getSyncStorageAsync } from "./utils.js";

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
        return new Promise((resolve, reject) => {
            Database.init({}, (result) => {
                if (result === null) {
                    reject(new Error('Database initialization failed'));
                } else {
                    globalThis.Database = Database;
                    resolve();
                }
            });
        });
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
        const initModule = (module, name) => {
            return new Promise((resolve, reject) => {
                module.init({}, (result) => {
                    if (result === null) {
                        reject(new Error(`${name} initialization failed`));
                    } else {
                        resolve();
                    }
                });
            });
        };

        await Promise.all([
            initModule(History, 'History'),
            initModule(Youtube, 'Youtube'),
            initModule(Search, 'Search')
        ]);

        logger.info('All modules initialized');
    }

    /**
     * Register all message handlers
     */
    registerMessageHandlers() {
        // Database handlers
        messageRouter.register('database-export', (req) =>
            handleDatabaseExport(req, Database));
        messageRouter.register('database-import', (req) =>
            handleDatabaseImport(req, Database));
        messageRouter.register('database-reset', (req) =>
            handleDatabaseReset(req, Database));
        messageRouter.register('database-size', (req) =>
            handleDatabaseSize(req, this.providerFactory));

        // YouTube handlers
        messageRouter.register('youtube-lookup', (req) =>
            handleYoutubeLookup(req, Youtube, (id, title) => videoTracker.cacheTitle(id, title)));
        messageRouter.register('youtube-ensure', (req) =>
            handleYoutubeEnsure(req, Youtube, (id, title) => videoTracker.cacheTitle(id, title)));
        messageRouter.register('youtube-synchronize', (req) =>
            handleYoutubeSynchronize(req, Youtube));
        messageRouter.register('youtube-liked-videos', (req) =>
            handleYoutubeLikedVideos(req, Youtube));

        // Search handlers
        messageRouter.register('search-videos', (req) =>
            handleSearchVideos(req, Search, Database));
        messageRouter.register('search-delete', (req) =>
            handleSearchDelete(req, Search));

        // History handlers
        messageRouter.register('history-synchronize', (req) =>
            handleHistorySynchronize(req, History));

        // Provider handlers
        messageRouter.register('database-provider-status', (req) =>
            handleProviderStatus(req, this.providerFactory));
        messageRouter.register('database-provider-switch', (req) =>
            handleProviderSwitch(req, this.providerFactory));
        messageRouter.register('database-provider-list', (req) =>
            handleProviderList(req, this.providerFactory));
        messageRouter.register('database-provider-migrate', (req) =>
            handleProviderMigrate(req, this.providerFactory));
        messageRouter.register('database-provider-sync', (req) =>
            handleProviderSync(req, this.providerFactory));

        // Supabase handlers
        messageRouter.register('supabase-configure', handleSupabaseConfigure);
        messageRouter.register('supabase-test', handleSupabaseTest);
        messageRouter.register('supabase-clear', handleSupabaseClear);
        messageRouter.register('supabase-get-credentials', handleSupabaseGetCredentials);
        messageRouter.register('supabase-get-status', handleSupabaseGetStatus);
        messageRouter.register('supabase-check-table', (req) =>
            handleSupabaseCheckTable(req, this.providerFactory));

        // Settings handlers
        messageRouter.register('get-setting', handleGetSetting);
        messageRouter.register('set-setting', handleSetSetting);

        // Sync manager handlers
        messageRouter.register('sync-manager-start', (req) => this.handleSyncManagerStart(req));
        messageRouter.register('sync-manager-stop', (req) => this.handleSyncManagerStop(req));
        messageRouter.register('sync-manager-sync-now', (req) => this.handleSyncManagerSyncNow(req));
        messageRouter.register('sync-manager-status', (req) => this.handleSyncManagerStatus(req));

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
            const shouldSyncYoutube = await getSyncStorageAsync('idCondition_Youhist') === true;

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
            const shouldSyncHistory = await getSyncStorageAsync('idCondition_Browhist') === true;
            const shouldSyncYoutube = await getSyncStorageAsync('idCondition_Youhist') === true;

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
        return new Promise((resolve, reject) => {
            History.synchronize(
                { intTimestamp: 0, skipExisting: true },
                (response) => {
                    if (response === null) {
                        reject(new Error('History synchronization failed'));
                    } else {
                        logger.info('History sync completed');
                        resolve(response);
                    }
                },
                (progress) => logger.debug('History sync progress:', progress)
            );
        });
    }

    /**
     * Sync YouTube history
     */
    async syncYoutube() {
        return new Promise((resolve) => {
            Youtube.synchronize(
                { intThreshold: 512 },
                (response) => {
                    logger.info('YouTube sync completed');
                    resolve(response);
                },
                (progress) => logger.debug('YouTube sync progress:', progress)
            );
        });
    }

    /**
     * Sync manager handlers
     */
    async handleSyncManagerStart(request) {
        return new Promise((resolve) => {
            SyncManagerInstance.startAutoSync(request, resolve);
        });
    }

    async handleSyncManagerStop(request) {
        return new Promise((resolve) => {
            SyncManagerInstance.stopAutoSync(request, resolve);
        });
    }

    async handleSyncManagerSyncNow(request) {
        return new Promise((resolve) => {
            SyncManagerInstance.syncNow(request, resolve);
        });
    }

    async handleSyncManagerStatus(request) {
        return new Promise((resolve) => {
            SyncManagerInstance.getStatus(request, resolve);
        });
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

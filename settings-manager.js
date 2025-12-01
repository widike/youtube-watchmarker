/**
 * Settings Manager
 * Manages extension settings and configuration
 */

import { logger } from './logger.js';
import {
    getSyncStorageAsync,
    setSyncStorageAsync,
    setDefaultInSyncStorageIfNull
} from './storage-utils.js';

/**
 * Settings configuration
 */
const SETTINGS_CONFIG = {
    integers: [
        { key: "databaseSize", defaultValue: 0 }
    ],
    booleans: [
        { key: "idCondition_Brownav", defaultValue: true },
        { key: "idCondition_Browhist", defaultValue: true },
        { key: "idCondition_Youprog", defaultValue: true },
        { key: "idCondition_Youbadge", defaultValue: true },
        { key: "idCondition_Youhist", defaultValue: true },
        { key: "idCondition_Yourating", defaultValue: true },
        { key: "idVisualization_Fadeout", defaultValue: true },
        { key: "idVisualization_Grayout", defaultValue: true },
        { key: "idVisualization_Showbadge", defaultValue: true },
        { key: "idVisualization_Showdate", defaultValue: true },
        { key: "idVisualization_Hideprogress", defaultValue: true },
        { key: "idVisualization_Showpublishdate", defaultValue: false }
    ],
    stylesheets: [
        {
            key: "stylesheet_Fadeout",
            defaultValue: ".youwatch-mark yt-img-shadow img, .youwatch-mark yt-image img, .youwatch-mark .ytp-videowall-still-image, .youwatch-mark img.yt-core-image, .youwatch-mark img.ytCoreImageHost { opacity:0.3; }"
        },
        {
            key: "stylesheet_Grayout",
            defaultValue: ".youwatch-mark yt-img-shadow img, .youwatch-mark yt-image img, .youwatch-mark .ytp-videowall-still-image, .youwatch-mark img.yt-core-image, .youwatch-mark img.ytCoreImageHost { filter:grayscale(1.0); }"
        },
        {
            key: "stylesheet_Showbadge",
            defaultValue: '.youwatch-mark::after { background-color:#000000; border-radius:2px; color:#FFFFFF; content:"WATCHED"; font-size:11px; left:4px; opacity:0.8; padding:3px 4px 3px 4px; position:absolute; top:4px; }'
        },
        {
            key: "stylesheet_Showdate",
            defaultValue: '.youwatch-mark::after { content:"WATCHED" attr(watchdate); white-space:nowrap; }'
        },
        {
            key: "stylesheet_Hideprogress",
            defaultValue: "ytd-thumbnail-overlay-resume-playback-renderer, ytm-thumbnail-overlay-resume-playback-renderer { display:none !important; }"
        }
    ]
};

/**
 * Settings Manager class
 */
export class SettingsManager {
    constructor() {
        this.isInitialized = false;
        this.logger = logger;
    }

    /**
     * Initialize settings with defaults
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        try {
            this.logger.info('Initializing settings...');

            // Initialize all setting types in parallel
            await Promise.all([
                this.initializeIntegerSettings(),
                this.initializeBooleanSettings(),
                this.initializeStylesheetSettings()
            ]);

            // Migrate old settings
            await this.migrateOldSettings();

            this.isInitialized = true;
            this.logger.info('Settings initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize settings:', error);
            throw error;
        }
    }

    /**
     * Initialize integer settings
     */
    async initializeIntegerSettings() {
        await Promise.all(
            SETTINGS_CONFIG.integers.map(({ key, defaultValue }) =>
                setDefaultInSyncStorageIfNull(key, defaultValue)
            )
        );
    }

    /**
     * Initialize boolean settings
     */
    async initializeBooleanSettings() {
        await Promise.all(
            SETTINGS_CONFIG.booleans.map(({ key, defaultValue }) =>
                setDefaultInSyncStorageIfNull(key, defaultValue)
            )
        );
    }

    /**
     * Initialize stylesheet settings
     */
    async initializeStylesheetSettings() {
        await Promise.all(
            SETTINGS_CONFIG.stylesheets.map(({ key, defaultValue }) =>
                setDefaultInSyncStorageIfNull(key, defaultValue)
            )
        );
    }

    /**
     * Migrate old YouTube auto sync setting to YouTube History condition
     */
    async migrateOldSettings() {
        try {
            const youtubeAutoSyncEnabled = await getSyncStorageAsync('youtube_auto_sync_enabled');
            if (youtubeAutoSyncEnabled === true) {
                // Enable YouTube History condition if it's not already set
                const currentYouHistCondition = await getSyncStorageAsync('idCondition_Youhist');
                if (currentYouHistCondition === undefined || currentYouHistCondition === null) {
                    await setSyncStorageAsync('idCondition_Youhist', true);
                    this.logger.info('Migrated youtube_auto_sync_enabled to idCondition_Youhist');
                }

                // Remove the old setting
                await chrome.storage.sync.remove('youtube_auto_sync_enabled');
                this.logger.info('Removed old youtube_auto_sync_enabled setting');
            }
        } catch (error) {
            this.logger.error('Error migrating old settings:', error);
        }
    }

    /**
     * Get a setting value
     * @param {string} key - Setting key
     * @returns {Promise<any>} Setting value
     */
    async getSetting(key) {
        return await getSyncStorageAsync(key);
    }

    /**
     * Set a setting value
     * @param {string} key - Setting key
     * @param {any} value - Setting value
     */
    async setSetting(key, value) {
        await setSyncStorageAsync(key, value);
        this.logger.debug(`Setting "${key}" updated to:`, value);
    }

    /**
     * Get multiple settings
     * @param {string[]} keys - Setting keys
     * @returns {Promise<Object>} Settings object
     */
    async getMultipleSettings(keys) {
        const result = await chrome.storage.sync.get(keys);
        return result;
    }

    /**
     * Set multiple settings
     * @param {Object} settings - Settings object
     */
    async setMultipleSettings(settings) {
        await chrome.storage.sync.set(settings);
        this.logger.debug('Updated multiple settings:', Object.keys(settings));
    }

    /**
     * Reset settings to defaults
     */
    async resetToDefaults() {
        this.logger.info('Resetting all settings to defaults...');

        const allSettings = {};

        // Add all defaults
        SETTINGS_CONFIG.integers.forEach(({ key, defaultValue }) => {
            allSettings[key] = defaultValue;
        });
        SETTINGS_CONFIG.booleans.forEach(({ key, defaultValue }) => {
            allSettings[key] = defaultValue;
        });
        SETTINGS_CONFIG.stylesheets.forEach(({ key, defaultValue }) => {
            allSettings[key] = defaultValue;
        });

        await chrome.storage.sync.set(allSettings);
        this.logger.info('Settings reset to defaults');
    }

    /**
     * Export all settings
     * @returns {Promise<Object>} All settings
     */
    async exportSettings() {
        const allKeys = [
            ...SETTINGS_CONFIG.integers.map(s => s.key),
            ...SETTINGS_CONFIG.booleans.map(s => s.key),
            ...SETTINGS_CONFIG.stylesheets.map(s => s.key)
        ];
        return await this.getMultipleSettings(allKeys);
    }

    /**
     * Import settings
     * @param {Object} settings - Settings to import
     */
    async importSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            throw new Error('Invalid settings object');
        }

        await this.setMultipleSettings(settings);
        this.logger.info('Settings imported successfully');
    }
}

/**
 * Create and export default settings manager instance
 */
export const settingsManager = new SettingsManager();

// @ts-check

/**
 * Settings Manager
 * Manages extension settings and configuration
 */

import { logger } from "./logger.js";

/**
 * Settings configuration
 */
const SETTINGS_CONFIG = {
  integers: [{ key: "databaseSize", defaultValue: 0 }],
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
    { key: "idVisualization_Showpublishdate", defaultValue: false },
  ],
  stylesheets: [
    {
      key: "stylesheet_Fadeout",
      defaultValue:
        ".youwatch-mark :is(yt-img-shadow img, yt-image img, yt-thumbnail-view-model img, yt-collection-thumbnail-view-model img, yt-collections-stack img, img.yt-core-image, img.ytCoreImageHost, .ytp-videowall-still-image) { opacity: 0.34; }",
    },
    {
      key: "stylesheet_Grayout",
      defaultValue:
        ".youwatch-mark :is(yt-img-shadow img, yt-image img, yt-thumbnail-view-model img, yt-collection-thumbnail-view-model img, yt-collections-stack img, img.yt-core-image, img.ytCoreImageHost, .ytp-videowall-still-image) { filter: grayscale(1); }",
    },
    {
      key: "stylesheet_Showbadge",
      defaultValue:
        '.youwatch-mark::after { align-items:center; backdrop-filter:blur(8px); background:rgb(15 15 15 / 0.82); border:1px solid rgb(255 255 255 / 0.08); border-radius:999px; color:#fff; content:"WATCHED"; display:inline-flex; font:500 11px/1.2 Roboto, Arial, sans-serif; inset-inline-start:8px; inset-block-start:8px; letter-spacing:0.02em; padding:5px 8px; position:absolute; text-transform:uppercase; z-index:1; }',
    },
    {
      key: "stylesheet_Showdate",
      defaultValue:
        '.youwatch-mark::after { content:"WATCHED" attr(watchdate); white-space:nowrap; }',
    },
    {
      key: "stylesheet_Hideprogress",
      defaultValue:
        "ytd-thumbnail-overlay-resume-playback-renderer, ytm-thumbnail-overlay-resume-playback-renderer { display:none !important; }",
    },
  ],
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
      this.logger.info("Initializing settings...");

      // Initialize all setting types in parallel
      await Promise.all([
        this.initializeSettingsByType(SETTINGS_CONFIG.integers),
        this.initializeSettingsByType(SETTINGS_CONFIG.booleans),
        this.initializeSettingsByType(SETTINGS_CONFIG.stylesheets),
      ]);

      this.isInitialized = true;
      this.logger.info("Settings initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize settings:", error);
      throw error;
    }
  }

  /**
   * Initialize settings by type from config
   * Consolidated method that replaces separate integer/boolean/stylesheet init methods
   * @param {Array<{key: string, defaultValue: any}>} config - Settings configuration array
   */
  async initializeSettingsByType(config) {
    const keys = config.map((s) => s.key);
    const existing = await chrome.storage.sync.get(keys);

    const toSet = config
      .filter(({ key }) => existing[key] === undefined)
      .reduce(
        (acc, { key, defaultValue }) => ({ ...acc, [key]: defaultValue }),
        {},
      );

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.sync.set(toSet);
    }
  }

  /**
   * Get a setting value
   * @param {string} key - Setting key
   * @returns {Promise<any>} Setting value
   */
  async getSetting(key) {
    const result = await chrome.storage.sync.get([key]);
    return result[key];
  }

  /**
   * Set a setting value
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   */
  async setSetting(key, value) {
    await chrome.storage.sync.set({ [key]: value });
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
    this.logger.debug("Updated multiple settings:", Object.keys(settings));
  }

  /**
   * Reset settings to defaults
   */
  async resetToDefaults() {
    this.logger.info("Resetting all settings to defaults...");

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
    this.logger.info("Settings reset to defaults");
  }

  /**
   * Export all settings
   * @returns {Promise<Object>} All settings
   */
  async exportSettings() {
    const allKeys = [
      ...SETTINGS_CONFIG.integers.map((s) => s.key),
      ...SETTINGS_CONFIG.booleans.map((s) => s.key),
      ...SETTINGS_CONFIG.stylesheets.map((s) => s.key),
    ];
    return await this.getMultipleSettings(allKeys);
  }

  /**
   * Import settings
   * @param {Object} settings - Settings to import
   */
  async importSettings(settings) {
    if (!settings || typeof settings !== "object") {
      throw new Error("Invalid settings object");
    }

    await this.setMultipleSettings(settings);
    this.logger.info("Settings imported successfully");
  }
}

/**
 * Create and export default settings manager instance
 */
export const settingsManager = new SettingsManager();

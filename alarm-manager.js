// @ts-check

/**
 * Alarm Manager
 * Manages Chrome alarms for periodic synchronization and keep-alive
 */

import { logger } from "./logger.js";

/**
 * Alarm configuration
 */
const ALARM_CONFIG = {
  SYNC: {
    name: "synchronize",
    defaultIntervalMinutes: 60,
    minIntervalMinutes: 0.5,
  },
};

/**
 * Alarm Manager class
 */
export class AlarmManager {
  constructor() {
    this.isInitialized = false;
    this.logger = logger;
    this.alarmHandlers = new Map();
    this.listenerBound = false;
  }

  /**
   * Initialize alarm manager
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.info("Initializing alarm manager...");
      this.bindListener();

      // Setup synchronization alarm
      await this.setupSynchronizationAlarm();

      this.isInitialized = true;
      this.logger.info("Alarm manager initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize alarm manager:", error);
      throw error;
    }
  }

  /**
   * Register an alarm handler
   * @param {string} alarmName - Alarm name
   * @param {Function} handler - Handler function
   */
  registerHandler(alarmName, handler) {
    this.alarmHandlers.set(alarmName, handler);
    this.logger.debug(`Registered handler for alarm: ${alarmName}`);
  }

  /**
   * Setup Chrome alarm listener
   */
  bindListener() {
    if (this.listenerBound) {
      return;
    }

    chrome.alarms.onAlarm.addListener(async (alarm) => {
      try {
        this.logger.debug(`Alarm triggered: ${alarm.name}`);

        const handler = this.alarmHandlers.get(alarm.name);
        if (handler) {
          await handler(alarm);
        } else {
          this.logger.warn(`No handler registered for alarm: ${alarm.name}`);
        }
      } catch (error) {
        this.logger.error(`Error handling alarm ${alarm.name}:`, error);
        await this.logAlarmFailure(alarm.name, error);
      }
    });

    this.listenerBound = true;
  }

  /**
   * Setup synchronization alarm
   */
  async setupSynchronizationAlarm() {
    try {
      // Clear any existing alarms to prevent duplicates
      await chrome.alarms.clear(ALARM_CONFIG.SYNC.name);

      // Get sync interval from settings
      const result = await chrome.storage.sync.get(["sync_interval_minutes"]);
      const syncInterval =
        result.sync_interval_minutes ||
        ALARM_CONFIG.SYNC.defaultIntervalMinutes;

      // Create alarm with minimum interval
      const periodInMinutes = Math.max(
        syncInterval,
        ALARM_CONFIG.SYNC.minIntervalMinutes,
      );

      this.logger.info(
        `Setting up synchronization alarm with ${periodInMinutes} minute interval`,
      );

      await chrome.alarms.create(ALARM_CONFIG.SYNC.name, {
        periodInMinutes: periodInMinutes,
      });

      // Verify alarm was created
      const alarm = await chrome.alarms.get(ALARM_CONFIG.SYNC.name);
      if (!alarm) {
        throw new Error("Failed to create synchronization alarm");
      }

      this.logger.info("Synchronization alarm created successfully");
    } catch (error) {
      this.logger.error("Error setting up synchronization alarm:", error);
      // Retry in 5 minutes
      setTimeout(() => this.setupSynchronizationAlarm(), 5 * 60 * 1000);
    }
  }

  /**
   * Update synchronization interval
   * @param {number} intervalMinutes - New interval in minutes
   */
  async updateSyncInterval(intervalMinutes) {
    this.logger.info(`Updating sync interval to ${intervalMinutes} minutes`);
    await chrome.storage.sync.set({ sync_interval_minutes: intervalMinutes });
    await this.setupSynchronizationAlarm();
  }

  /**
   * Log alarm failure for debugging
   * @param {string} alarmName - Name of failed alarm
   * @param {Error} error - Error that occurred
   */
  async logAlarmFailure(alarmName, error) {
    try {
      const failureLog = {
        alarmName,
        error: error.message,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      };

      // Store in local storage for debugging
      const result = await chrome.storage.local.get(["alarm_failure_logs"]);
      const existingLogs = result.alarm_failure_logs || "[]";
      const logs = JSON.parse(existingLogs);
      logs.push(failureLog);

      // Keep only last 10 failure logs
      if (logs.length > 10) {
        logs.splice(0, logs.length - 10);
      }

      await chrome.storage.local.set({
        alarm_failure_logs: JSON.stringify(logs),
      });
    } catch (logError) {
      this.logger.error("Error logging alarm failure:", logError);
    }
  }

  /**
   * Get alarm failure logs
   * @returns {Promise<Array>} Array of alarm failure logs
   */
  async getAlarmFailureLogs() {
    try {
      const result = await chrome.storage.local.get(["alarm_failure_logs"]);
      const logs = result.alarm_failure_logs || "[]";
      return JSON.parse(logs);
    } catch (error) {
      this.logger.error("Error getting alarm failure logs:", error);
      return [];
    }
  }

  /**
   * Clear alarm failure logs
   */
  async clearAlarmFailureLogs() {
    try {
      await chrome.storage.local.set({ alarm_failure_logs: "[]" });
      this.logger.info("Alarm failure logs cleared");
    } catch (error) {
      this.logger.error("Error clearing alarm failure logs:", error);
    }
  }

  /**
   * Get all active alarms
   * @returns {Promise<Array>} Array of active alarms
   */
  async getAllAlarms() {
    return await chrome.alarms.getAll();
  }

  /**
   * Clear a specific alarm
   * @param {string} alarmName - Name of alarm to clear
   */
  async clearAlarm(alarmName) {
    await chrome.alarms.clear(alarmName);
    this.logger.info(`Alarm cleared: ${alarmName}`);
  }

  /**
   * Clear all alarms
   */
  async clearAllAlarms() {
    await chrome.alarms.clearAll();
    this.logger.info("All alarms cleared");
  }
}

/**
 * Create and export default alarm manager instance
 */
export const alarmManager = new AlarmManager();

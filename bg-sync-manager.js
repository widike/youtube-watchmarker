import { databaseProviderFactory } from "./database-provider-factory.js";

export const HISTORY_SYNC_ALARM = "history-cloud-sync";

export class SyncManager {
  async init() {
    if (!(await chrome.alarms.get(HISTORY_SYNC_ALARM))) {
      await chrome.alarms.create(HISTORY_SYNC_ALARM, { periodInMinutes: 0.5 });
    }
  }

  async syncNow(options) {
    try {
      return await databaseProviderFactory.performDeltaSync(options);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getStatus() {
    return {
      success: true,
      status: await databaseProviderFactory.getProviderStatus(),
    };
  }
}

export const SyncManagerInstance = new SyncManager();

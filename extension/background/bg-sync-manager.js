import { databaseProviderFactory } from "../providers/database-provider-factory.js";

export const HISTORY_SYNC_ALARM = "history-cloud-sync";

export class SyncManager {
  async init() {
    if (!(await chrome.alarms.get(HISTORY_SYNC_ALARM))) {
      await chrome.alarms.create(HISTORY_SYNC_ALARM, { periodInMinutes: 0.5 });
    }
  }

  async syncNow(options) {
    return databaseProviderFactory.performDeltaSync(options);
  }

  async getStatus() {
    return {
      success: true,
      status: await databaseProviderFactory.getProviderStatus(),
    };
  }
}

export const SyncManagerInstance = new SyncManager();

import { databaseProviderFactory } from "./database-provider-factory.js";

export const HISTORY_SYNC_ALARM = "history-cloud-sync";

export class SyncManager {
  async init() {
    if (!(await chrome.alarms.get(HISTORY_SYNC_ALARM))) {
      await chrome.alarms.create(HISTORY_SYNC_ALARM, { periodInMinutes: 0.5 });
    }
  }

  async syncNow(options) {
    // YouTube retries also run for local-only or disconnected installations.
    const [cloud, youtube] = await Promise.allSettled([
      databaseProviderFactory.performDeltaSync(options),
      databaseProviderFactory.youtubeDeletions.retry(),
    ]);
    const result =
      cloud.status === "fulfilled"
        ? cloud.value
        : { success: false, error: cloud.reason.message };
    const deletionError =
      youtube.status === "rejected"
        ? youtube.reason.message
        : youtube.value?.success === false
          ? youtube.value.error
          : null;
    return deletionError
      ? {
          ...result,
          success: false,
          error: [result.error, `YouTube: ${deletionError}`]
            .filter(Boolean)
            .join("; "),
        }
      : result;
  }

  async getStatus() {
    return {
      success: true,
      status: await databaseProviderFactory.getProviderStatus(),
    };
  }
}

export const SyncManagerInstance = new SyncManager();

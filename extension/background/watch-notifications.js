import { logger } from "../shared/logger.js";

export async function broadcastWatchState(message) {
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
    await Promise.all(
      tabs.map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id, message);
        } catch {
          // Tabs without the content script (or closing tabs) are normal.
        }
      }),
    );
  } catch (error) {
    logger.debug("Watch marker notification unavailable:", error.message);
  }
}

// Imports can partially succeed before failing. Refresh either way, without
// making a successful history write depend on an open content-script recipient.
export async function withWatchmarkerRefresh(operation) {
  let result;
  try {
    result = await operation();
    return result;
  } finally {
    if (result?.downloaded !== 0)
      await broadcastWatchState({ action: "youtube-refresh" });
  }
}

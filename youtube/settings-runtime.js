"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;

  class ContentSettingsStore {
    constructor() {
      this.cache = {};
      this.settingKeys = [
        "stylesheet_Fadeout",
        "stylesheet_Grayout",
        "stylesheet_Showbadge",
        "stylesheet_Showdate",
        "stylesheet_Hideprogress",
        "idVisualization_Fadeout",
        "idVisualization_Grayout",
        "idVisualization_Showbadge",
        "idVisualization_Showdate",
        "idVisualization_Hideprogress",
        "idVisualization_Showpublishdate",
      ];
    }

    async load() {
      if (!this.isStorageAvailable()) {
        this.cache = Object.fromEntries(
          this.settingKeys.map((key) => [key, false]),
        );
        return;
      }

      const result = await chrome.storage.sync.get(this.settingKeys);
      this.cache = { ...result };
    }

    isStorageAvailable() {
      return Boolean(chrome?.storage?.sync) && core.isRuntimeAvailable();
    }

    async get(key) {
      if (Object.hasOwn(this.cache, key)) {
        return this.cache[key] || false;
      }

      if (!this.isStorageAvailable()) {
        return false;
      }

      const result = await chrome.storage.sync.get([key]);
      this.cache[key] = result[key] || false;
      return this.cache[key];
    }

    onChange(callback) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== "sync") {
          return;
        }

        for (const [key, value] of Object.entries(changes)) {
          this.cache[key] = value.newValue;
        }

        callback(changes);
      });
    }
  }

  class BackgroundClient {
    async send(message) {
      if (!core.isRuntimeAvailable()) {
        return null;
      }

      try {
        return await chrome.runtime.sendMessage(message);
      } catch (error) {
        const retryable =
          error?.message?.includes("Receiving end does not exist") ||
          error?.message?.includes("Extension context invalidated") ||
          error?.message?.includes("context invalidated");

        if (!retryable) {
          throw error;
        }

        try {
          return await chrome.runtime.sendMessage(message);
        } catch (retryError) {
          core.logError("Background request failed after retry", retryError);
          return null;
        }
      }
    }
  }

  watchmarker.ContentSettingsStore = ContentSettingsStore;
  watchmarker.BackgroundClient = BackgroundClient;
})();

"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;

  class YouTubeWatchmarkerApp {
    constructor() {
      this.isProcessing = false;
      this.refreshPending = false;
      this.settingsStore = new watchmarker.ContentSettingsStore();
      this.backgroundClient = new watchmarker.BackgroundClient();
      this.styleManager = new watchmarker.ContentStyleManager(
        this.settingsStore,
      );
      this.videoMarkerManager = new watchmarker.VideoMarkerManager(
        this.backgroundClient,
      );
      this.playbackTracker = new watchmarker.PlaybackTracker(
        this.backgroundClient,
        this.videoMarkerManager,
      );
      this.interactionManager = new watchmarker.InteractionManager(
        this.playbackTracker,
      );
      this.pageObserverManager = new watchmarker.PageObserverManager(() =>
        this.refresh(),
      );
    }

    async initialize() {
      if (!core.isRuntimeAvailable()) {
        throw new Error("Extension runtime is not available");
      }

      await this.settingsStore.load();
      await this.styleManager.render();

      this.registerMessageListener();
      this.registerSettingsListener();
      this.playbackTracker.initialize();
      this.interactionManager.initialize();
      this.pageObserverManager.initialize();

      await this.refresh();
    }

    registerMessageListener() {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === "youtube-refresh") {
          this.videoMarkerManager.invalidate();
          void this.refresh();
        }

        if (message.action === "youtube-mark" && message.videoId) {
          this.videoMarkerManager.updateWatchState(
            message.videoId,
            message.timestamp || 0,
            message.count,
          );
        }

        sendResponse(null);
      });
    }

    registerSettingsListener() {
      this.settingsStore.onChange(async (changes) => {
        if (Object.keys(changes).some((key) => key.startsWith("idCondition_")))
          this.playbackTracker.retrySettings();
        const visualSettingChanged = this.settingsStore.settingKeys.some(
          (key) => changes[key],
        );

        if (visualSettingChanged) {
          await this.styleManager.render();
          await this.refresh();
        }
      });
    }

    async refresh() {
      if (!core.isRuntimeAvailable()) return;
      if (this.isProcessing) {
        this.refreshPending = true;
        return;
      }

      this.isProcessing = true;

      try {
        do {
          this.refreshPending = false;
          this.playbackTracker.refresh();
          if (core.isWatchHistoryPage()) {
            this.videoMarkerManager.clearMarks();
          } else {
            await this.videoMarkerManager.processVideos(core.findVideos());
          }
        } while (this.refreshPending);
      } catch (error) {
        core.logError("Failed to refresh YouTube watch markers", error);
      } finally {
        this.isProcessing = false;
      }
    }
  }

  watchmarker.YouTubeWatchmarkerApp = YouTubeWatchmarkerApp;

  function bootstrap() {
    const app = new YouTubeWatchmarkerApp();
    void app
      .initialize()
      .catch((error) =>
        core.logError("Failed to initialize YouTube watchmarker", error),
      );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

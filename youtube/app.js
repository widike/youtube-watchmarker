"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;

  class YouTubeWatchmarkerApp {
    constructor() {
      this.isProcessing = false;
      this.lastSnapshot = "";
      this.settingsStore = new watchmarker.ContentSettingsStore();
      this.backgroundClient = new watchmarker.BackgroundClient();
      this.styleManager = new watchmarker.ContentStyleManager(
        this.settingsStore,
      );
      this.videoMarkerManager = new watchmarker.VideoMarkerManager(
        this.backgroundClient,
      );
      this.interactionManager = new watchmarker.InteractionManager(
        this.videoMarkerManager,
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
      this.interactionManager.initialize();
      this.pageObserverManager.initialize();

      await this.refresh();
    }

    registerMessageListener() {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === "youtube-refresh") {
          void this.refresh();
        }

        if (message.action === "youtube-mark" && message.videoId) {
          this.videoMarkerManager.updateWatchState(
            message.videoId,
            message.timestamp || 0,
          );
        }

        sendResponse(null);
      });
    }

    registerSettingsListener() {
      this.settingsStore.onChange(async (changes) => {
        const visualSettingChanged = [
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
        ].some((key) => changes[key]);

        if (visualSettingChanged) {
          await this.styleManager.render();
          await this.refresh();
        }
      });
    }

    async refresh() {
      if (this.isProcessing || !core.isRuntimeAvailable()) {
        return;
      }

      this.isProcessing = true;

      try {
        if (core.isWatchHistoryPage()) {
          this.videoMarkerManager.clearMarks();
          this.lastSnapshot = window.location.href;
          return;
        }

        const videos = core.findVideos();
        const nextSnapshot = `${window.location.href}:${document.title}:${videos.length}`;
        if (nextSnapshot === this.lastSnapshot) {
          return;
        }

        this.lastSnapshot = nextSnapshot;

        await this.videoMarkerManager.processVideos(videos);
      } catch (error) {
        core.logError("Failed to refresh YouTube watch markers", error);
      } finally {
        this.isProcessing = false;
      }
    }
  }

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

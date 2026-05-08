"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;
  const WATCHMARK_VISUAL_TARGET_SELECTOR =
    ".youwatch-mark img, img.youwatch-mark, .youwatch-mark .ytp-videowall-still-image, .ytp-videowall-still-image.youwatch-mark";

  function buildWatchmarkVisualRule(declaration) {
    return `${WATCHMARK_VISUAL_TARGET_SELECTOR} { ${declaration} !important; }`;
  }

  class ContentStyleManager {
    constructor(settingsStore) {
      this.settingsStore = settingsStore;
      this.styleElementId = "youwatch-injected-styles";
    }

    async render() {
      const settings = await this.getVisualSettings();
      const stylesheet = this.buildStylesheet(settings);

      const existing = document.getElementById(this.styleElementId);
      if (existing) {
        existing.remove();
      }

      if (!stylesheet.trim()) {
        return;
      }

      const styleElement = document.createElement("style");
      styleElement.id = this.styleElementId;
      styleElement.textContent = stylesheet;
      document.head.appendChild(styleElement);
    }

    async getVisualSettings() {
      const keys = [
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
      ];

      const settings = {};
      for (const key of keys) {
        settings[key] = await this.settingsStore.get(key);
      }
      return settings;
    }

    buildStylesheet(settings) {
      let stylesheet = "";

      if (settings.idVisualization_Fadeout) {
        if (settings.stylesheet_Fadeout) {
          stylesheet += `${settings.stylesheet_Fadeout}\n`;
        }
        stylesheet += `${buildWatchmarkVisualRule("opacity: 0.34")}\n`;
      }

      if (settings.idVisualization_Grayout) {
        if (settings.stylesheet_Grayout) {
          stylesheet += `${settings.stylesheet_Grayout}\n`;
        }
        stylesheet += `${buildWatchmarkVisualRule("filter: grayscale(1)")}\n`;
      }

      if (settings.idVisualization_Showbadge && settings.stylesheet_Showbadge) {
        stylesheet += `${settings.stylesheet_Showbadge}\n`;
      }

      if (settings.idVisualization_Showdate && settings.stylesheet_Showdate) {
        stylesheet += `${settings.stylesheet_Showdate}\n`;
      }

      if (
        settings.idVisualization_Hideprogress &&
        settings.stylesheet_Hideprogress
      ) {
        stylesheet += `${settings.stylesheet_Hideprogress}\n`;
      }

      return stylesheet;
    }
  }

  class VideoMarkerManager {
    constructor(backgroundClient) {
      this.backgroundClient = backgroundClient;
      this.watchDates = new Map();
      this.pendingLookups = new Set();
      this.observers = new WeakMap();
    }

    getWatchTimestamp(videoId) {
      return this.watchDates.get(videoId) ?? null;
    }

    updateWatchState(videoId, timestamp = 0) {
      this.watchDates.set(videoId, timestamp);
      this.markVideosWithId(videoId);
    }

    removeWatchState(videoId) {
      this.watchDates.delete(videoId);
      this.markVideosWithId(videoId);
    }

    markVideosWithId(videoId) {
      core
        .findVideos(videoId)
        .forEach((video) => this.markVideo(video, videoId));
    }

    markVideo(videoElement, videoId) {
      if (!videoId) {
        return;
      }

      const timestamp = this.getWatchTimestamp(videoId);
      const isWatched = timestamp !== null;
      const target = this.resolveMarkTarget(videoElement);
      const alreadyMarked = target.classList.contains("youwatch-mark");

      if (isWatched && !alreadyMarked) {
        target.classList.add("youwatch-mark");
      }

      if (!isWatched && alreadyMarked) {
        target.classList.remove("youwatch-mark");
        target.removeAttribute("watchdate");
      }

      if (!isWatched) {
        return;
      }

      if (timestamp) {
        const watchDate = new Date(timestamp).toLocaleDateString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        target.setAttribute("watchdate", ` ${watchDate}`);
      } else {
        target.removeAttribute("watchdate");
      }
    }

    resolveMarkTarget(videoElement) {
      const notification = videoElement.closest("ytd-notification-renderer");
      if (notification) {
        return (
          notification.querySelector(".thumbnail-container") ||
          notification.querySelector("yt-img-shadow") ||
          notification.querySelector("img") ||
          videoElement
        );
      }

      const renderer = videoElement.closest(
        "yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer",
      );

      if (!renderer) {
        return videoElement;
      }

      const thumbnailElement = renderer.querySelector(
        "yt-collection-thumbnail-view-model, yt-thumbnail-view-model, yt-image, yt-img-shadow, yt-collections-stack, img",
      );

      return (
        thumbnailElement?.closest?.(
          'a[href^="/watch?v="], a[href^="/shorts/"]',
        ) ||
        renderer.querySelector(
          'a.ytd-thumbnail[href^="/watch?v="], a[href^="/shorts/"]',
        ) ||
        videoElement
      );
    }

    observeVideo(videoElement) {
      if (this.observers.has(videoElement)) {
        return;
      }

      const observer = new MutationObserver(() => {
        const videoId = core.extractVideoId(videoElement);
        this.markVideo(videoElement, videoId);
      });

      observer.observe(videoElement, {
        attributes: true,
        attributeFilter: ["href"],
      });

      this.observers.set(videoElement, observer);
    }

    async requestVideoData(videoElement, videoId) {
      if (
        !videoId ||
        this.watchDates.has(videoId) ||
        this.pendingLookups.has(videoId)
      ) {
        return;
      }

      this.pendingLookups.add(videoId);

      try {
        const response = await this.backgroundClient.send({
          action: "youtube-lookup",
          videoId,
          title: core.extractVideoTitle(videoElement),
        });

        if (response?.success !== false && response?.strIdent === videoId) {
          this.updateWatchState(videoId, response.intTimestamp || 0);
        }
      } finally {
        this.pendingLookups.delete(videoId);
      }
    }

    async markAsWatchedFromInteraction(videoId, title) {
      if (!videoId) {
        return;
      }

      const response = await this.backgroundClient.send({
        action: "youtube-ensure",
        videoId,
        title,
      });

      if (response?.success === false) {
        return;
      }

      const timestamp = response?.data?.intTimestamp || Date.now();
      this.updateWatchState(videoId, timestamp);
    }

    async processVideos(videos) {
      const batchSize = 12;

      for (let index = 0; index < videos.length; index += batchSize) {
        const batch = videos.slice(index, index + batchSize);

        await Promise.all(
          batch.map(async (video) => {
            const videoId = core.extractVideoId(video);
            this.markVideo(video, videoId);
            this.observeVideo(video);
            await this.requestVideoData(video, videoId);
          }),
        );
      }
    }
  }
  watchmarker.ContentStyleManager = ContentStyleManager;
  watchmarker.VideoMarkerManager = VideoMarkerManager;
})();

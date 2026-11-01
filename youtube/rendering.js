"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;
  class ContentStyleManager {
    constructor(settingsStore) {
      this.settingsStore = settingsStore;
      this.styleElementId = "youwatch-injected-styles";
    }

    async render() {
      const settings = await this.getVisualSettings();
      const stylesheet = this.buildStylesheet(settings);

      const existing = document.getElementById(this.styleElementId);
      if (!stylesheet.trim()) {
        existing?.remove();
        return;
      }
      const styleElement = existing || document.createElement("style");
      styleElement.id = this.styleElementId;
      styleElement.textContent = stylesheet;
      if (!existing) document.head.appendChild(styleElement);
    }

    async getVisualSettings() {
      return Object.fromEntries(
        await Promise.all(
          this.settingsStore.settingKeys.map(async (key) => [
            key,
            await this.settingsStore.get(key),
          ]),
        ),
      );
    }

    buildStylesheet(settings) {
      return this.settingsStore.features
        .filter((name) => settings[`idVisualization_${name}`])
        .map((name) => settings[`stylesheet_${name}`] || "")
        .join("\n");
    }
  }

  class VideoMarkerManager {
    constructor(backgroundClient) {
      this.backgroundClient = backgroundClient;
      this.watchStates = new Map();
      this.pendingLookups = new Set();
      this.lookupTimes = new Map();
      this.generation = 0;
    }

    getWatchTimestamp(videoId) {
      return this.watchStates.get(videoId)?.timestamp ?? null;
    }

    updateWatchState(videoId, timestamp = 0, count = 1) {
      const previous = this.watchStates.get(videoId);
      this.watchStates.set(videoId, {
        timestamp: Math.max(previous?.timestamp || 0, timestamp),
        count: Math.max(
          previous?.count || 1,
          Number.isSafeInteger(count) && count > 0 ? count : 1,
        ),
      });
      this.markVideosWithId(videoId);
    }

    invalidate() {
      this.generation++;
      this.watchStates.clear();
      this.lookupTimes.clear();
      this.pendingLookups.clear();
    }

    clearMarks() {
      document.querySelectorAll(".youwatch-mark").forEach((target) => {
        target.classList.remove("youwatch-mark");
        target.removeAttribute("watchdate");
        target.removeAttribute("watchcount");
      });
    }

    markVideosWithId(videoId) {
      core
        .findVideos(videoId)
        .forEach((video) => this.markVideo(video, videoId));
    }

    markVideo(videoElement, videoId) {
      const target = this.resolveMarkTarget(videoElement);
      const alreadyMarked = target.classList.contains("youwatch-mark");

      if (core.isWatchHistoryPage()) {
        if (alreadyMarked) {
          target.classList.remove("youwatch-mark");
          target.removeAttribute("watchdate");
          target.removeAttribute("watchcount");
        }
        return;
      }

      const timestamp = this.getWatchTimestamp(videoId);
      const isWatched = timestamp !== null;

      if (isWatched && !alreadyMarked) {
        target.classList.add("youwatch-mark");
      }

      if (!isWatched && alreadyMarked) {
        target.classList.remove("youwatch-mark");
        target.removeAttribute("watchdate");
        target.removeAttribute("watchcount");
      }

      if (!isWatched) {
        return;
      }

      target.setAttribute(
        "watchcount",
        ` ×${this.watchStates.get(videoId).count}`,
      );

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
      // End-card images can be siblings of the link. Mark the card itself so
      // both the thumbnail and badge remain inside the fullscreen player.
      const playerTile = videoElement.closest(
        ".ytp-ce-video, a.ytp-videowall-still, a.ytp-autonav-endscreen-link-container",
      );
      if (playerTile) return playerTile;

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
          'a[href*="/watch?"], a[href*="/shorts/"]',
        ) ||
        renderer.querySelector(
          'a.ytd-thumbnail[href*="/watch?"], a[href*="/shorts/"]',
        ) ||
        videoElement
      );
    }

    async requestVideoData(videoId) {
      if (
        !videoId ||
        this.watchStates.has(videoId) ||
        this.pendingLookups.has(videoId) ||
        Date.now() - (this.lookupTimes.get(videoId) || 0) < 30_000
      ) {
        return;
      }

      this.pendingLookups.add(videoId);
      const generation = this.generation;

      try {
        const response = await this.backgroundClient.send({
          action: "youtube-lookup",
          videoId,
        });

        if (generation !== this.generation) return;
        if (
          response?.success === true &&
          response?.strIdent === videoId &&
          !this.watchStates.has(videoId)
        ) {
          this.updateWatchState(
            videoId,
            response.intTimestamp || 0,
            response.intCount,
          );
        }
        if (response?.success === true)
          this.lookupTimes.set(videoId, Date.now());
      } finally {
        if (generation === this.generation) this.pendingLookups.delete(videoId);
      }
    }

    async processVideos(videos) {
      // YouTube reuses thumbnail nodes, including changing a link to a non-video.
      document.querySelectorAll(".youwatch-mark").forEach((target) => {
        this.markVideo(target, core.extractVideoId(target));
      });
      const batchSize = 12;

      for (let index = 0; index < videos.length; index += batchSize) {
        const batch = videos.slice(index, index + batchSize);

        await Promise.all(
          batch.map(async (video) => {
            const videoId = core.extractVideoId(video);
            this.markVideo(video, videoId);
            try {
              await this.requestVideoData(videoId);
            } catch (error) {
              core.logError("Failed to look up watched video", error);
            }
          }),
        );
      }
    }
  }
  watchmarker.ContentStyleManager = ContentStyleManager;
  watchmarker.VideoMarkerManager = VideoMarkerManager;
})();

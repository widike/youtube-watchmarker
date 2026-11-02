"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;

  class InteractionManager {
    constructor(playbackTracker) {
      this.playbackTracker = playbackTracker;
    }

    initialize() {
      this.setupRatingObserver();
    }

    setupRatingObserver() {
      document.addEventListener(
        "click",
        (event) => {
          const button = event.target.closest?.('button, [role="button"]');
          if (!this.isRatingButton(button)) {
            return;
          }

          setTimeout(() => this.handleRatingChange(button), 100);
        },
        true,
      );
    }

    isRatingButton(element) {
      if (!element) {
        return false;
      }

      const selectors = [
        'ytd-toggle-button-renderer[target-id="watch-like"]',
        'ytd-toggle-button-renderer[target-id="watch-dislike"]',
        "#segmented-like-button button",
        "#segmented-dislike-button button",
        "like-button-view-model button",
        "dislike-button-view-model button",
      ];

      return selectors.some((selector) => {
        try {
          return element.matches(selector) || element.closest(selector);
        } catch (_error) {
          return false;
        }
      });
    }

    handleRatingChange(button) {
      const isPressed =
        button.getAttribute("aria-pressed") === "true" ||
        button.classList.contains("style-default-active");
      if (!isPressed) {
        return;
      }

      const videoId = core.getCurrentVideoId();
      if (!videoId) {
        return;
      }

      void this.playbackTracker.report("rating");
    }
  }

  class PageObserverManager {
    constructor(refreshCallback) {
      this.refreshCallback = refreshCallback;
    }

    initialize() {
      const debouncedRefresh = core.debounce(this.refreshCallback, 100);

      const observer = new MutationObserver((mutations) => {
        const shouldRefresh = mutations.some(
          (mutation) =>
            mutation.type === "attributes" ||
            mutation.addedNodes.length > 0 ||
            mutation.removedNodes.length > 0,
        );

        if (shouldRefresh) {
          debouncedRefresh();
        }
      });

      observer.observe(document.body, {
        childList: true,
        attributes: true,
        attributeFilter: ["href", "src"],
        subtree: true,
      });
      document.addEventListener("yt-navigate-finish", debouncedRefresh);
      document.addEventListener("fullscreenchange", debouncedRefresh);
      window.addEventListener("popstate", debouncedRefresh);
    }
  }

  watchmarker.InteractionManager = InteractionManager;
  watchmarker.PageObserverManager = PageObserverManager;
})();

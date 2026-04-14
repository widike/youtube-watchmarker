"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;

  class InteractionManager {
    constructor(videoMarkerManager) {
      this.videoMarkerManager = videoMarkerManager;
    }

    initialize() {
      this.setupRatingObserver();
      this.setupProgressListener();
    }

    setupRatingObserver() {
      document.addEventListener(
        "click",
        (event) => {
          const button = event.target.closest('button, [role="button"]');
          if (!this.isRatingButton(button)) {
            return;
          }

          setTimeout(() => this.handleRatingChange(button), 100);
        },
        true,
      );

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== "attributes") {
            continue;
          }

          const button = mutation.target;
          if (this.isRatingButton(button)) {
            this.handleRatingChange(button);
          }
        }
      });

      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["aria-pressed", "class"],
        childList: true,
        subtree: true,
      });
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
        'button[aria-label*="like"]',
        'button[aria-label*="dislike"]',
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

      void this.videoMarkerManager.markAsWatchedFromInteraction(
        videoId,
        core.getCurrentVideoTitle(),
      );
    }

    setupProgressListener() {
      document.addEventListener("youwatch-progresshook", (event) => {
        const { strIdent, strTitle } = event.detail || {};
        if (!strIdent || strIdent.length !== 11) {
          return;
        }

        void this.videoMarkerManager.markAsWatchedFromInteraction(
          strIdent,
          strTitle,
        );
      });
    }
  }

  class PageObserverManager {
    constructor(refreshCallback) {
      this.refreshCallback = refreshCallback;
    }

    initialize() {
      const debouncedRefresh = core.debounce(this.refreshCallback, 100);

      const observer = new MutationObserver((mutations) => {
        const shouldRefresh = mutations.some((mutation) => {
          if (
            mutation.type !== "childList" ||
            mutation.addedNodes.length === 0
          ) {
            return false;
          }

          return Array.from(mutation.addedNodes).some((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
              return false;
            }

            return (
              node.matches?.(core.videoSelectors.join(", ")) ||
              node.querySelector?.(core.videoSelectors.join(", "))
            );
          });
        });

        if (shouldRefresh) {
          debouncedRefresh();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  watchmarker.InteractionManager = InteractionManager;
  watchmarker.PageObserverManager = PageObserverManager;
})();

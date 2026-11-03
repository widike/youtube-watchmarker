"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent || {};
  globalThis.YouTubeWatchmarkerContent = watchmarker;

  const videoSelectors = [
    'a.ytd-thumbnail[href*="/watch?"]',
    'a.ytd-thumbnail[href*="/shorts/"]',
    "a#thumbnail[href]",
    'yt-lockup-view-model a[href*="/watch?"]',
    'yt-lockup-view-model a[href*="/shorts/"]',
    'yt-lockup-view-model a.yt-lockup-view-model__content-image[href*="/watch?"]',
    'ytd-watch-next-secondary-results-renderer a[href*="/watch?"]',
    'ytd-item-section-renderer a[href*="/watch?"]',
    'ytd-compact-video-renderer a[href*="/watch?"]',
    "a.ytp-ce-covering-overlay[href]",
    "a.ytp-videowall-still[href]",
    "a.ytp-modern-videowall-still[href]",
    "a.ytp-autonav-endscreen-link-container[href]",
    'a.ShortsLockupViewModelHostEndpoint[href*="/shorts/"]',
    'a.reel-item-endpoint[href*="/shorts/"]',
    'a.media-item-thumbnail-container[href*="/watch?"]',
    "ytd-notification-renderer a",
    "ytd-notification-renderer .thumbnail-container img",
  ];

  const { parseVideoId: parseVideoIdFromUrl } =
    globalThis.YouTubeWatchmarkerVideo;

  function extractVideoId(input) {
    if (typeof input === "string") {
      return parseVideoIdFromUrl(input);
    }

    if (!input || typeof input !== "object") {
      return null;
    }

    // The link is authoritative when YouTube has not yet replaced its image.
    const href = input.getAttribute?.("href") || input.href;
    if (href) return parseVideoIdFromUrl(href);
    const parentLink = input.closest?.("a[href]");
    if (parentLink)
      return parseVideoIdFromUrl(
        parentLink.getAttribute?.("href") || parentLink.href,
      );
    const link = input.querySelector?.("a[href]");
    if (link)
      return parseVideoIdFromUrl(link.getAttribute?.("href") || link.href);
    const image = input.querySelector?.(
      'img[src*="/vi/"], img[src*="/vi_webp/"]',
    );
    return parseVideoIdFromUrl(
      input.getAttribute?.("src") || input.src || image?.getAttribute?.("src"),
    );
  }

  function isWatchHistoryPage() {
    return /^\/feed\/history(?:\/|$)/.test(window.location.pathname);
  }

  function findVideos(targetVideoId = "") {
    if (isWatchHistoryPage()) {
      return [];
    }

    return Array.from(
      document.querySelectorAll(videoSelectors.join(", ")),
    ).filter((element) => {
      const isCommentVideo = element.closest(
        "ytd-comment-renderer, ytd-comment-thread-renderer, #comments",
      );
      const isAuthorThumbnail = element.closest(
        "#author-thumbnail, ytd-comment-avatar-renderer",
      );
      if (isCommentVideo || isAuthorThumbnail) {
        return false;
      }

      const videoId = extractVideoId(element);
      if (!videoId) {
        return false;
      }

      return !targetVideoId || videoId === targetVideoId;
    });
  }

  function debounce(callback, wait) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => callback(...args), wait);
    };
  }

  function isRuntimeAvailable() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (_error) {
      return false;
    }
  }

  function logError(message, error) {
    console.error(message, {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
    });
  }

  function getCurrentVideoId() {
    return parseVideoIdFromUrl(window.location.href);
  }

  function getCurrentVideoTitle() {
    const titleSelectors = [
      "ytd-reel-video-renderer[is-active] h2",
      "ytd-watch-metadata h1",
      "ytm-slim-video-metadata-renderer h1",
      "h1.ytd-video-primary-info-renderer",
      "h1.ytd-watch-metadata",
      ".ytd-video-primary-info-renderer h1",
    ];

    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }

      const title = element.textContent?.trim();
      if (title) return title;
    }

    // Head metadata can lag behind SPA navigation. Only use it when it
    // explicitly belongs to the video currently playing.
    const metadataId = document
      .querySelector('meta[itemprop="videoId"]')
      ?.getAttribute("content");
    if (metadataId && metadataId === getCurrentVideoId()) {
      for (const selector of [
        'meta[name="title"]',
        'meta[property="og:title"]',
      ]) {
        const title = document
          .querySelector(selector)
          ?.getAttribute("content")
          ?.trim();
        if (title) return title;
      }
    }
    const title = document.title.replace(/\s+-\s+YouTube\s*$/i, "").trim();
    return /^(?:YouTube|Loading\.{0,3}|-\s*YouTube)$/i.test(title) ? "" : title;
  }

  watchmarker.core = {
    videoSelectors,
    extractVideoId,
    isWatchHistoryPage,
    findVideos,
    debounce,
    isRuntimeAvailable,
    logError,
    getCurrentVideoId,
    getCurrentVideoTitle,
  };
})();

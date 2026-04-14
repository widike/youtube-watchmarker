"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent || {};
  globalThis.YouTubeWatchmarkerContent = watchmarker;

  const videoSelectors = [
    'a.ytd-thumbnail[href^="/watch?v="]',
    'a.ytd-thumbnail[href^="/shorts/"]',
    'yt-lockup-view-model a[href^="/watch?v="]',
    'yt-lockup-view-model a[href^="/shorts/"]',
    'yt-lockup-view-model a.yt-lockup-view-model__content-image[href^="/watch?v="]',
    'ytd-watch-next-secondary-results-renderer a[href^="/watch?v="]',
    'ytd-item-section-renderer a[href^="/watch?v="]',
    'ytd-compact-video-renderer a[href^="/watch?v="]',
    'a.ytp-ce-covering-overlay[href*="/watch?v="]',
    'a.ytp-videowall-still[href*="/watch?v="]',
    'a.ShortsLockupViewModelHostEndpoint[href^="/shorts/"]',
    'a.reel-item-endpoint[href^="/shorts/"]',
    'a.media-item-thumbnail-container[href^="/watch?v="]',
    "ytd-notification-renderer a",
    "ytd-notification-renderer .thumbnail-container img",
  ];

  function parseVideoIdFromUrl(url) {
    if (!url || typeof url !== "string") {
      return null;
    }

    const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch) {
      return watchMatch[1];
    }

    const shortsMatch = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) {
      return shortsMatch[1];
    }

    const redirectMatch = url.match(/[?&]q=([^&]+)/);
    if (redirectMatch) {
      try {
        return parseVideoIdFromUrl(decodeURIComponent(redirectMatch[1]));
      } catch (_error) {
        return null;
      }
    }

    const thumbnailMatch = url.match(/\/vi\/([a-zA-Z0-9_-]{11})\//);
    if (thumbnailMatch) {
      return thumbnailMatch[1];
    }

    const tail = url.split("&")[0].slice(-11);
    return /^[a-zA-Z0-9_-]{11}$/.test(tail) ? tail : null;
  }

  function extractVideoId(input) {
    if (typeof input === "string") {
      return parseVideoIdFromUrl(input);
    }

    if (!input || typeof input !== "object") {
      return null;
    }

    const ownHref = parseVideoIdFromUrl(input.href);
    if (ownHref) {
      return ownHref;
    }

    const link = input.querySelector?.("a[href]");
    const linkedId =
      parseVideoIdFromUrl(link?.getAttribute?.("href")) ||
      parseVideoIdFromUrl(link?.href);
    if (linkedId) {
      return linkedId;
    }

    const image = input.querySelector?.('img[src*="/vi/"]');
    return parseVideoIdFromUrl(image?.getAttribute?.("src"));
  }

  function extractVideoTitle(videoElement) {
    let current = videoElement;

    for (let depth = 0; depth < 5 && current; depth += 1) {
      const titleElement = current.querySelector?.("#video-title");
      if (titleElement?.innerText) {
        return titleElement.innerText.trim();
      }
      current = current.parentElement;
    }

    return "";
  }

  function extractPublishDate(videoElement) {
    const tile =
      videoElement.closest(".ytp-videowall-still") ||
      videoElement.parentElement?.closest?.(".ytp-videowall-still") ||
      null;

    const extractAgoText = (text) => {
      if (!text) {
        return null;
      }

      const trimmedText = text.trim();
      const exactMatch = trimmedText.match(
        /(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/i,
      );
      if (exactMatch) {
        return exactMatch[1];
      }

      const streamedMatch = trimmedText.match(
        /(?:Streamed|Premiered)\s+(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/i,
      );
      if (streamedMatch) {
        return streamedMatch[1];
      }

      if (!trimmedText.toLowerCase().includes("ago")) {
        return null;
      }

      const agoIndex = trimmedText.toLowerCase().lastIndexOf("ago");
      const tokenPrefix = trimmedText
        .slice(0, agoIndex)
        .trim()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean)
        .slice(-2)
        .join(" ");

      return tokenPrefix ? `${tokenPrefix} ago` : null;
    };

    const textCandidates = tile
      ? [
          tile.getAttribute?.("aria-label"),
          tile.getAttribute?.("title"),
          videoElement.getAttribute?.("aria-label"),
          videoElement.getAttribute?.("title"),
          ...Array.from(tile.querySelectorAll("span, div, a")).map(
            (element) =>
              element.getAttribute("aria-label")?.trim() ||
              element.textContent?.trim(),
          ),
        ]
      : [];

    for (const candidate of textCandidates) {
      const publishDate = extractAgoText(candidate);
      if (publishDate) {
        return publishDate;
      }
    }

    let current = videoElement.parentElement;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const candidateText = Array.from(current.querySelectorAll("span, div, a"))
        .map(
          (element) =>
            element.getAttribute("aria-label")?.trim() ||
            element.textContent?.trim(),
        )
        .find((text) => extractAgoText(text));

      if (candidateText) {
        return extractAgoText(candidateText);
      }

      current = current.parentElement;
    }

    return null;
  }

  function findVideos(targetVideoId = "") {
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

  function findVideoTitleElement(videoElement) {
    const videoWallTile =
      videoElement.closest(".ytp-videowall-still") ||
      videoElement.parentElement?.closest?.(".ytp-videowall-still");

    if (videoWallTile) {
      const videoWallTitle = videoWallTile.querySelector(
        ".ytp-videowall-still-info-title",
      );
      if (videoWallTitle?.textContent?.trim()) {
        return videoWallTitle;
      }
    }

    let current = videoElement.parentElement;
    for (let depth = 0; depth < 5 && current; depth += 1) {
      const titleElement = current.querySelector?.(
        "#video-title, #video-title-link, h3 a",
      );
      if (titleElement?.textContent?.trim()) {
        return titleElement;
      }
      current = current.parentElement;
    }

    return null;
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
      "h1.ytd-video-primary-info-renderer",
      "h1.ytd-watch-metadata",
      ".ytd-video-primary-info-renderer h1",
      'meta[property="og:title"]',
    ];

    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }

      if (element.tagName === "META") {
        return element.getAttribute("content") || "";
      }

      return element.textContent?.trim() || "";
    }

    return document.title.replace(" - YouTube", "");
  }

  watchmarker.core = {
    videoSelectors,
    extractVideoId,
    extractVideoTitle,
    extractPublishDate,
    findVideos,
    findVideoTitleElement,
    debounce,
    isRuntimeAvailable,
    logError,
    getCurrentVideoId,
    getCurrentVideoTitle,
  };
})();

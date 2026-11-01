"use strict";

// Shared by classic content scripts and the module-based service worker.
(() => {
  const hosts = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
  ]);
  const isVideoId = (id) =>
    typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);

  function parseVideoId(value, depth = 0) {
    if (typeof value !== "string" || !value || depth > 3) return null;
    try {
      const url = new URL(value, "https://www.youtube.com");
      if (!["https:", "http:"].includes(url.protocol)) return null;
      let id;
      if (hosts.has(url.hostname)) {
        if (url.pathname === "/watch") id = url.searchParams.get("v");
        else
          id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
        if (["/redirect", "/attribution_link"].includes(url.pathname)) {
          const target =
            url.searchParams.get("q") ||
            url.searchParams.get("url") ||
            url.searchParams.get("u");
          return parseVideoId(target, depth + 1);
        }
      } else if (url.hostname === "youtu.be") {
        id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
      } else if (/(^|\.)ytimg\.com$/.test(url.hostname)) {
        id = url.pathname.match(/^\/vi(?:_webp)?\/([^/]+)\//)?.[1];
      }
      return isVideoId(id) ? id : null;
    } catch {
      return null;
    }
  }

  globalThis.YouTubeWatchmarkerVideo = { isVideoId, parseVideoId };
})();

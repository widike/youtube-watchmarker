"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;
  const CARD_SELECTOR = [
    "yt-lockup-view-model",
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-playlist-video-renderer",
    "ytd-reel-item-renderer",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
    "a.ytp-modern-videowall-still",
    "a.ytp-videowall-still",
    ".ytp-ce-video",
  ].join(", ");

  class BlockedVideoManager {
    constructor(settingsStore, backgroundClient) {
      this.settingsStore = settingsStore;
      this.backgroundClient = backgroundClient;
      this.blocked = new Set();
      this.loadGeneration = 0;
    }

    async load() {
      const generation = ++this.loadGeneration;
      const response = await this.backgroundClient.send({
        action: "blocked-videos-list",
      });
      if (!response?.success)
        throw new Error(response?.error || "Could not load blocked videos");
      if (generation === this.loadGeneration)
        this.blocked = new Set(
          (response.videos || []).map((video) => video.videoId),
        );
    }

    findCards() {
      const cards = new Map();
      if (core.isWatchHistoryPage()) return cards;
      for (const anchor of document.querySelectorAll(
        'a[href*="/watch?"], a[href*="/shorts/"], a[href*="/live/"], a.ytp-ce-covering-overlay[href]',
      )) {
        if (
          anchor.closest(
            "h3, #comments, ytd-comment-renderer, ytd-notification-renderer, #video-preview, ytd-video-preview, #mouseover-overlay",
          )
        )
          continue;
        const host = anchor.closest(CARD_SELECTOR);
        if (!host || cards.has(host) || !core.extractVideoId(anchor)) continue;
        if (
          !anchor.matches(
            ".ytp-modern-videowall-still, .ytp-videowall-still, .ytp-ce-covering-overlay",
          ) &&
          !anchor.querySelector(
            "img, yt-image, yt-thumbnail-view-model, .ytCoreImageHost",
          )
        )
          continue;
        cards.set(host, anchor);
      }
      return cards;
    }

    async processVideos() {
      const enabled = await this.settingsStore.get("idBlocking_Enabled");
      const cards = enabled ? this.findCards() : new Map();
      const hidden = new Set();
      for (const [host, anchor] of cards) {
        const videoId = core.extractVideoId(anchor);
        const target = host.closest("ytd-rich-item-renderer") || host;
        if (this.blocked.has(videoId)) hidden.add(target);
        host.classList.add("youwatch-block-host");
        if (!host.querySelector(":scope > .youwatch-block-button"))
          host.appendChild(this.createButton(host));
      }
      for (const target of document.querySelectorAll(".youwatch-blocked"))
        if (!hidden.has(target)) target.classList.remove("youwatch-blocked");
      for (const target of hidden) target.classList.add("youwatch-blocked");
      for (const host of document.querySelectorAll(".youwatch-block-host")) {
        if (cards.has(host)) continue;
        host.querySelector(":scope > .youwatch-block-button")?.remove();
        host.classList.remove("youwatch-block-host");
      }
    }

    createButton(host) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "youwatch-block-button";
      button.title = "Hide video locally";
      button.setAttribute("aria-label", button.title);
      button.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
      const stop = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      for (const type of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "dblclick",
      ])
        button.addEventListener(type, stop, true);
      for (const type of ["keydown", "keyup"])
        button.addEventListener(type, (event) => event.stopPropagation());
      button.addEventListener(
        "click",
        (event) => {
          stop(event);
          if (!button.disabled) void this.blockCard(host, button);
        },
        true,
      );
      return button;
    }

    async blockCard(host, button) {
      // Resolve the current link at click time: YouTube recycles card nodes.
      const anchor = this.findCards().get(host);
      const videoId = core.extractVideoId(anchor);
      if (!videoId) return;
      const titleElement = host.querySelector(
        "h3 a, h3, #video-title, a#video-title-link, .yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, .ytp-videowall-still-info-title, .ytp-modern-videowall-still-info-title",
      );
      const title = (
        titleElement?.getAttribute("title") ||
        titleElement?.textContent ||
        anchor.getAttribute("aria-label") ||
        ""
      )
        .trim()
        .slice(0, 2000);
      button.disabled = true;
      try {
        const response = await this.backgroundClient.send({
          action: "blocked-videos-block",
          videoId,
          title,
        });
        if (!response?.success)
          throw new Error(response?.error || "Could not hide video");
        await this.load();
        await this.processVideos();
      } catch (error) {
        button.title = "Could not hide video. Try again.";
        button.setAttribute("aria-label", button.title);
        core.logError("Failed to hide video locally", error);
      } finally {
        button.disabled = false;
      }
    }
  }

  watchmarker.BlockedVideoManager = BlockedVideoManager;
})();

"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const { core } = watchmarker;

  class PlaybackTracker {
    constructor(backgroundClient, videoMarkerManager) {
      this.backgroundClient = backgroundClient;
      this.videoMarkerManager = videoMarkerManager;
      this.session = null;
      this.endedPlayer = null;
      this.watchTime = new watchmarker.WatchTimeTracker(backgroundClient);
    }

    initialize() {
      for (const name of [
        "timeupdate",
        "playing",
        "ended",
        "pause",
        "waiting",
        "seeking",
        "seeked",
        "ratechange",
        "emptied",
      ]) {
        document.addEventListener(
          name,
          (event) => this.handlePlayerEvent(event),
          true,
        );
      }
      document.addEventListener("yt-navigate-start", () => {
        this.watchTime.reset();
        this.navigating = true;
      });
      window.addEventListener("pagehide", () => {
        this.watchTime.reset(true);
        this.session = null;
        this.endedPlayer = null;
      });
      document.addEventListener(
        "visibilitychange",
        () => void this.watchTime.flush(),
      );
      document.addEventListener("yt-navigate-finish", () => {
        this.navigating = false;
        this.refresh();
      });
    }

    createSession(videoId, replay = false) {
      this.watchTime.reset(true);
      this.endedPlayer = null;
      this.session = {
        videoId,
        sessionId: crypto.randomUUID(),
        replay,
        title: core.getCurrentVideoTitle(),
        watchedMilliseconds: 0,
        reasons: new Set(),
        reports: new Map(),
      };
      return this.session;
    }

    currentSession() {
      if (this.navigating) return null;
      const videoId = core.getCurrentVideoId();
      if (!videoId) {
        this.watchTime.reset(true);
        this.session = null;
        this.endedPlayer = null;
        return null;
      }
      if (this.session?.videoId !== videoId) this.createSession(videoId);
      return this.session;
    }

    refresh() {
      const session = this.currentSession();
      if (session && !session.replay) void this.report("navigation");
    }

    retrySettings() {
      this.session?.reports.clear();
      this.refresh();
    }

    isMainPlayer(player) {
      if (player?.tagName !== "VIDEO") return false;
      if (
        player.closest(".ad-showing, .ad-interrupting, #inline-preview-player")
      )
        return false;
      const short = player.closest("ytd-reel-video-renderer");
      if (short && !short.hasAttribute("is-active")) return false;
      return Boolean(
        player.closest(
          "#movie_player, #shorts-player, ytd-reel-video-renderer[is-active], ytm-player",
        ),
      );
    }

    handlePlayerEvent(event) {
      const player = event.target;
      if (!this.isMainPlayer(player) || !this.currentSession()) {
        this.watchTime.reset();
        return;
      }
      if (event.type === "ended") {
        this.watchTime.observe(player, event.type, this.session);
        this.endedPlayer = player;
        if (player.ended && player.currentTime > 0)
          void this.report("progress");
        return;
      }
      const loopRestarted =
        player.loop &&
        !player.seeking &&
        this.session.player === player &&
        Number.isFinite(player.duration) &&
        player.duration > 0 &&
        this.session.lastTime >= player.duration - 0.5 &&
        player.currentTime < 0.5 &&
        player.currentTime < this.session.lastTime;
      if (
        (this.endedPlayer === player || loopRestarted) &&
        !player.ended &&
        !player.paused
      ) {
        this.createSession(this.session.videoId, true);
      }
      this.session.player = player;
      this.session.lastTime = player.currentTime;
      this.watchTime.observe(player, event.type, this.session);
      void this.report("progress");
    }

    async report(reason) {
      const session = this.currentSession();
      if (!session) return;
      session.reasons.add(reason);
      if (session.watchedMilliseconds < watchmarker.MINIMUM_WATCH_MILLISECONDS)
        return;
      const title = core.getCurrentVideoTitle();
      await Promise.all(
        [...session.reasons].map((signal) =>
          this.reportReason(session, signal, title),
        ),
      );
    }

    async reportReason(session, reason, title) {
      // Title changes may improve metadata, but reuse the same playback ID.
      const key = `${reason}:${title}`;
      if (session.reports.has(key)) return session.reports.get(key);
      const pending = this.sendReport(session, reason, title);
      session.reports.set(key, pending);
      const succeeded = await pending;
      if (!succeeded) session.reports.delete(key);
    }

    async sendReport(session, reason, title) {
      try {
        const response = await this.backgroundClient.send({
          action: "youtube-watch",
          videoId: session.videoId,
          sessionId: session.sessionId,
          watchedMilliseconds: session.watchedMilliseconds,
          reason,
          title,
        });
        if (response?.success !== true) return false;
        if (response.data?.strIdent === session.videoId) {
          this.videoMarkerManager.updateWatchState(
            session.videoId,
            response.data.intTimestamp,
            response.data.intCount,
          );
        }
        return true;
      } catch (error) {
        core.logError("Failed to record video playback", error);
        return false;
      }
    }
  }

  watchmarker.PlaybackTracker = PlaybackTracker;
})();

import { broadcastWatchState } from "./watch-notifications.js";
import "../shared/video-identity.js";
import { isValidVideoTitle } from "../shared/validation.js";
import { cleanHistoryTitle } from "../sources/browser-history-parser.js";
import { videoTitleRecovery } from "../shared/video-title-recovery.js";

const { isVideoId, parseVideoId } = globalThis.YouTubeWatchmarkerVideo;
export const LIVE_WATCH_CONDITIONS = {
  navigation: "idCondition_Brownav",
  progress: "idCondition_Youprog",
  rating: "idCondition_Yourating",
};

/** Records one view per playback, regardless of how many detectors report it. */
export class VideoTracker {
  async initialize(youtubeModule) {
    this.youtubeModule = youtubeModule;
  }

  async recordWatch(request, sender) {
    const { videoId, sessionId, reason } = request;
    const tabId = sender?.tab?.id;
    if (
      !isVideoId(videoId) ||
      !/^[a-f0-9-]{36}$/i.test(sessionId || "") ||
      !Object.hasOwn(LIVE_WATCH_CONDITIONS, reason) ||
      !Number.isInteger(tabId) ||
      tabId < 0 ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      // sender.url stays at the document's first URL; YouTube navigates in place.
      parseVideoId(sender.tab.url) !== videoId
    ) {
      throw new Error("Invalid watch event");
    }
    if (
      !Number.isFinite(request.watchedMilliseconds) ||
      request.watchedMilliseconds < 60_000
    )
      return null;
    const settings = await chrome.storage.sync.get(
      LIVE_WATCH_CONDITIONS[reason],
    );
    if (settings[LIVE_WATCH_CONDITIONS[reason]] !== true) return null;

    if (
      !Number.isSafeInteger(request.eventWatchedAt) ||
      request.eventWatchedAt <= 0 ||
      request.eventWatchedAt > Date.now() + 2000
    )
      throw new Error("Invalid playback start");
    const playbackId = `${tabId}:${sender.documentId || ""}:${sessionId}`;
    const title = isValidVideoTitle(request.title)
      ? request.title
      : cleanHistoryTitle(sender.tab.title);
    const video = await this.youtubeModule.recordPlayback(
      videoId,
      title,
      playbackId,
      request.eventWatchedAt,
    );
    // Recording stays local and immediate even if metadata is unavailable.
    if (video && !isValidVideoTitle(video.strTitle)) {
      const recovered = await videoTitleRecovery.find(videoId);
      if (recovered) {
        const saved = await this.youtubeModule
          .getProvider()
          .repairVideoTitle(videoId, recovered);
        if (saved) video.strTitle = saved;
      }
    }
    if (video) {
      await broadcastWatchState({
        action: "youtube-mark",
        videoId: video.strIdent,
        timestamp: video.intTimestamp,
        title: video.strTitle,
        count: video.intCount,
      });
    }
    return video;
  }
}

export const videoTracker = new VideoTracker();

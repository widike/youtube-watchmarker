import { broadcastWatchState } from "./watch-notifications.js";
import "./shared/video-identity.js";

const { isVideoId, parseVideoId } = globalThis.YouTubeWatchmarkerVideo;
const CONDITIONS = {
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
      !Object.hasOwn(CONDITIONS, reason) ||
      !Number.isInteger(tabId) ||
      tabId < 0 ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      parseVideoId(sender.url || sender.tab.url) !== videoId
    ) {
      throw new Error("Invalid watch event");
    }
    if (
      !Number.isFinite(request.watchedMilliseconds) ||
      request.watchedMilliseconds < 60_000
    )
      return null;
    const settings = await chrome.storage.sync.get(CONDITIONS[reason]);
    if (settings[CONDITIONS[reason]] !== true) return null;

    const playbackId = `${tabId}:${sender.documentId || ""}:${sessionId}`;
    const video = await this.youtubeModule.recordPlayback(
      videoId,
      request.title,
      playbackId,
    );
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

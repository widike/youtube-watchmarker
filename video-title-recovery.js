import {
  cleanHistoryTitle,
  extractHistoryVideoId,
} from "./browser-history-parser.js";
import { isValidVideoTitle } from "./validation.js";

// Recover metadata only. A browser visit must never create a watch event.
export class VideoTitleRecovery {
  constructor() {
    this.pending = new Map();
    this.retryAfter = new Map();
  }

  async find(videoId) {
    if (this.pending.has(videoId)) return this.pending.get(videoId);
    if ((this.retryAfter.get(videoId) || 0) > Date.now()) return "";
    const lookup = (async () => {
      try {
        const items = await chrome.history.search({
          text: videoId,
          startTime: 0,
          maxResults: 100,
        });
        return (
          items
            .filter((item) => extractHistoryVideoId(item.url) === videoId)
            .sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))
            .map((item) => cleanHistoryTitle(item.title))
            .find(Boolean) || ""
        );
      } catch {
        return "";
      }
    })();
    this.pending.set(videoId, lookup);
    try {
      const title = await lookup;
      if (!title) this.retryAfter.set(videoId, Date.now() + 5 * 60_000);
      return title;
    } finally {
      this.pending.delete(videoId);
    }
  }

  async repair(provider, videos) {
    const missing = videos
      .filter((video) => !isValidVideoTitle(video.strTitle))
      .filter((video) => !(this.retryAfter.get(video.strIdent) > Date.now()))
      .sort((a, b) => b.intTimestamp - a.intTimestamp)
      .slice(0, 50);
    await Promise.all(
      missing.map(async (video) => {
        const title = await this.find(video.strIdent);
        if (!title) return;
        const saved = await provider.repairVideoTitle(video.strIdent, title);
        if (saved) video.strTitle = saved;
      }),
    );
  }
}

export const videoTitleRecovery = new VideoTitleRecovery();

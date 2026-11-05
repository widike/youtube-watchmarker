import { isValidVideoId } from "../shared/validation.js";
import {
  compareBlocks,
  normalizeBlock,
} from "../shared/blocked-video-records.js";

export const BLOCKED_VIDEOS_KEY = "watchmarker_blocked_videos";

export class BlockedVideoStore {
  constructor(storage = chrome.storage.local, now = Date.now) {
    this.storage = storage;
    this.now = now;
    this.pending = Promise.resolve();
  }

  async list() {
    await this.pending;
    return (await this.read())
      .filter((video) => video.blocked)
      .sort((left, right) => compareBlocks(right, left));
  }

  async read() {
    const stored = (await this.storage.get(BLOCKED_VIDEOS_KEY))[
      BLOCKED_VIDEOS_KEY
    ];
    return Array.isArray(stored) ? stored : [];
  }

  update(videoId, title, blocked) {
    if (!isValidVideoId(videoId)) throw new Error("Invalid video ID");
    return this.edit(async (records) => {
      const videos = records.filter((video) => video.videoId !== videoId);
      const latest = records.reduce(
        (time, video) => Math.max(time, video.updatedAt),
        0,
      );
      videos.unshift({
        ...normalizeBlock({
          videoId,
          title: typeof title === "string" ? title.trim().slice(0, 2000) : "",
          blocked,
          updatedAt: Math.max(this.now(), latest + 1),
          changeId: crypto.randomUUID(),
        }),
        pending: true,
      });
      return videos;
    });
  }

  edit(callback) {
    const operation = this.pending.then(async () => {
      const previous = await this.read();
      const videos = await callback(previous);
      if (JSON.stringify(previous) !== JSON.stringify(videos))
        await this.storage.set({ [BLOCKED_VIDEOS_KEY]: videos });
      return videos;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async pendingRecords() {
    await this.pending;
    return (await this.read()).filter((video) => video.pending);
  }

  async acknowledge(records) {
    const acknowledged = new Set(records.map((row) => row.changeId));
    await this.edit(async (videos) =>
      videos.map((row) =>
        acknowledged.has(row.changeId) ? { ...row, pending: false } : row,
      ),
    );
  }

  async merge(records) {
    const normalized = records.map(normalizeBlock);
    await this.edit(async (videos) => {
      const merged = new Map(videos.map((row) => [row.videoId, row]));
      for (const row of normalized) {
        const current = merged.get(row.videoId);
        if (!current || compareBlocks(row, current) > 0)
          merged.set(row.videoId, { ...row, pending: false });
      }
      return [...merged.values()];
    });
  }
}

let store;
export const getBlockedVideoStore = () => (store ||= new BlockedVideoStore());

// Content scripts cannot access local storage, which also holds credentials.
// Send only a notification; they retrieve the list through the message router.
export async function notifyBlockedVideosChanged() {
  const tabs = await chrome.tabs.query({ url: "*://*.youtube.com/*" });
  await Promise.allSettled(
    tabs.map((tab) =>
      chrome.tabs.sendMessage(tab.id, { action: "youtube-blocklist-changed" }),
    ),
  );
}

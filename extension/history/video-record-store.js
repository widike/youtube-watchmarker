import { isValidVideoId, isValidVideoTitle } from "../shared/validation.js";
import { normalizeVideoTitle } from "../shared/text-utils.js";
import { mergeVideo } from "./history-records.js";
import { mergeSourceVideo } from "./history-source.js";

const positiveInteger = (value) =>
  Number.isFinite(Number(value)) && Number(value) >= 1
    ? Math.floor(Number(value))
    : 1;
const timestampOf = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

/** All read/modify/write operations for an individual video share one queue. */
export class VideoRecordStore {
  constructor() {
    this.writes = new WeakMap();
  }

  serialize(provider, videoId, operation) {
    if (!isValidVideoId(videoId))
      return Promise.reject(new Error("Invalid video ID"));
    if (!this.writes.has(provider)) this.writes.set(provider, new Map());
    const queue = this.writes.get(provider);
    const previous = queue.get(videoId) || Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    queue.set(videoId, result);
    void result
      .finally(() => {
        if (queue.get(videoId) === result) queue.delete(videoId);
      })
      .catch(() => {});
    return result;
  }

  getSourceTimestamp(video) {
    return timestampOf(video?.intTimestamp);
  }

  selectTitle(existingTitle = "", sourceTitle = "") {
    const existing = normalizeVideoTitle(existingTitle);
    const source = normalizeVideoTitle(sourceTitle);
    if (isValidVideoTitle(source)) return source;
    return existing;
  }

  async lookup(videoId) {
    if (!isValidVideoId(videoId)) throw new Error("Invalid video ID");
    const video = await this.getProvider().getVideo(videoId);
    return video
      ? {
          strIdent: video.strIdent,
          intTimestamp: timestampOf(video.intTimestamp) || 0,
          strTitle: normalizeVideoTitle(video.strTitle),
          intCount: positiveInteger(video.intCount),
        }
      : null;
  }

  recordPlayback(videoId, title, playbackId) {
    const provider = this.getProvider();
    return this.serialize(provider, videoId, () =>
      provider.recordPlayback(videoId, this.selectTitle("", title), playbackId),
    );
  }

  recoverPlayback({ videoId, title, playbackId, watchedAt }) {
    const provider = this.getProvider();
    return this.serialize(provider, videoId, () =>
      provider.recordPlayback(
        videoId,
        this.selectTitle("", title),
        playbackId,
        watchedAt,
      ),
    );
  }

  upsertSourceVideo(provider, source, { createOnly = false } = {}) {
    return this.serialize(provider, source.strIdent, async () => {
      const existing = await provider.getVideo(source.strIdent, {
        includeDeleted: true,
      });
      const sourceTimestamp = this.getSourceTimestamp(source);
      // Likes supply membership, not a watch date. An existing video is
      // already covered, including tombstones and separately tracked plays.
      if (existing && (createOnly || !sourceTimestamp))
        return { status: "skipped" };
      const strTitle = this.selectTitle(existing?.strTitle, source.strTitle);
      const video = mergeSourceVideo(
        existing ? { ...existing, strTitle } : null,
        {
          ...source,
          intTimestamp: sourceTimestamp || 0,
          strTitle,
        },
      );
      if (
        existing &&
        JSON.stringify(video) === JSON.stringify(mergeVideo(null, existing))
      )
        return { status: "skipped" };
      await provider.putVideo(video);
      return { status: existing ? "updated" : "created", video };
    });
  }
}

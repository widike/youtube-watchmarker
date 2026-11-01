import { logger } from "./logger.js";
import { isValidVideoTitle } from "./validation.js";
import {
  extractHistoryVideoId,
  mergeHistoryItem,
} from "./browser-history-parser.js";
import { searchBrowserHistory } from "./browser-history-search.js";
import { mergeSourceVideo } from "./history-source.js";
import { summarizeSource } from "./source-preview.js";

export async function synchronizeBrowserHistory(
  manager,
  startTime,
  skipExisting,
  onProgress,
  { preview = false, signal } = {},
) {
  const provider = manager.getProvider();
  const keepAlive = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 25_000);
  const result = {
    objVideos: [],
    videoCount: 0,
    newCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    unknownTimestampCount: 0,
    totalSeen: 0,
  };
  const videos = new Map();
  const seenUrls = new Set();
  let failedCount = 0;
  try {
    signal?.throwIfAborted();
    // Snapshot the upper bound: new visits belong to the next sync.
    const endTime = Date.now() + 1;
    if (startTime < endTime) {
      for await (const items of searchBrowserHistory(startTime, endTime, {
        signal,
      })) {
        for (const item of items) {
          if (item.url && seenUrls.has(item.url)) continue;
          if (item.url) seenUrls.add(item.url);
          result.totalSeen++;
          const id = extractHistoryVideoId(item.url);
          if (!id) {
            result.skippedCount++;
            continue;
          }
          if (!Number.isFinite(item.lastVisitTime) || item.lastVisitTime <= 0) {
            result.skippedCount++;
            result.unknownTimestampCount++;
            continue;
          }
          mergeHistoryItem(videos, item, id);
        }
        onProgress?.({
          strProgress: `Scanned ${result.totalSeen} browser history entries`,
        });
      }
    }
    if (preview) {
      return {
        ...(await summarizeSource(videos.keys(), provider, { signal })),
        unknownTimestampCount: result.unknownTimestampCount,
      };
    }
    for (const video of videos.values()) {
      try {
        const existing = await provider.getVideo(video.strIdent);
        if (existing && skipExisting) {
          result.skippedCount++;
          continue;
        }
        const merged = mergeSourceVideo(
          existing
            ? {
                ...existing,
                strTitle: isValidVideoTitle(existing.strTitle)
                  ? existing.strTitle
                  : video.strTitle,
              }
            : null,
          {
            ...video,
            strTitle: isValidVideoTitle(existing?.strTitle)
              ? existing.strTitle
              : video.strTitle || existing?.strTitle || "",
          },
        );
        const changed =
          !existing ||
          merged.intTimestamp !== existing.intTimestamp ||
          merged.strTitle !== (existing.strTitle || "") ||
          merged.intCount !== (existing.intCount || 1) ||
          JSON.stringify(merged.watchEvents) !==
            JSON.stringify(existing.watchEvents);
        if (!changed) {
          result.skippedCount++;
          continue;
        }
        await provider.putVideo(merged);
        result.objVideos.push(merged);
        if (existing) result.updatedCount++;
        else result.newCount++;
      } catch (error) {
        failedCount++;
        logger.error(
          `Error storing browser history video ${video.strIdent}:`,
          error,
        );
      }
      if ((result.newCount + result.updatedCount) % 100 === 0) {
        onProgress?.({
          strProgress: `Imported ${result.newCount + result.updatedCount} browser history videos`,
        });
      }
    }
    if (failedCount) {
      throw new Error(
        `Could not store ${failedCount} browser history videos; sync is incomplete. Retry the sync.`,
      );
    }
    result.videoCount = result.newCount;
    logger.info(
      `Browser history sync completed: ${result.newCount} new, ${result.updatedCount} updated, ${result.skippedCount} skipped.`,
    );
    return result;
  } finally {
    clearInterval(keepAlive);
  }
}

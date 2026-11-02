import { YOUTUBE } from "../shared/constants.js";
import { logger } from "../shared/logger.js";
import { extractInnerTubeConfig } from "./youtube-page-data.js";
import { summarizeSource } from "./source-preview.js";
import { requestYouTubeApi } from "./youtube-request.js";
import {
  historyImportCutoff,
  isHistoricalWatch,
} from "../history/history-import-policy.js";

export async function synchronizeYouTubeSource(
  manager,
  onProgress,
  {
    url,
    label,
    parsePage,
    parseContinuation,
    includeVideos = false,
    historicalOnly = false,
    preview = false,
    signal,
  },
) {
  const cutoff = historicalOnly ? await historyImportCutoff() : null;
  const provider = manager.getProvider();
  // Full history and playlist imports can exceed MV3's idle timeout during writes.
  const keepAlive = setInterval(() => {
    void chrome.runtime.getPlatformInfo();
  }, 25_000);
  const result = {
    objVideos: [],
    videoCount: 0,
    newCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    totalSeen: 0,
    pagesFetched: 0,
  };
  let failedCount = 0;
  const seenVideos = new Set();
  const previewIds = new Set();
  const store = async (videos) => {
    signal?.throwIfAborted();
    for (const video of videos) {
      const occurrence = `${video.strIdent}:${video.intTimestamp || 0}`;
      if (seenVideos.has(occurrence)) continue;
      seenVideos.add(occurrence);
      result.totalSeen++;
      if (historicalOnly && !isHistoricalWatch(video, cutoff)) {
        result.skippedCount++;
        continue;
      }
      if (preview) {
        previewIds.add(video.strIdent);
        continue;
      }
      try {
        const { status } = await manager.upsertSourceVideo(provider, video);
        if (status === "created") result.newCount++;
        else if (status === "updated") result.updatedCount++;
        else result.skippedCount++;
        if (includeVideos) result.objVideos.push(video);
      } catch (error) {
        failedCount++;
        logger.error(`Error storing ${label} video ${video.strIdent}:`, error);
      }
      if (result.totalSeen % 25 === 0) {
        onProgress?.({
          strProgress: `Scanned ${result.totalSeen} ${label} videos; added ${result.newCount}`,
        });
      }
    }
  };
  try {
    signal?.throwIfAborted();
    logger.info(`Starting full ${label} sync...`);
    const response = await fetch(url, {
      credentials: "include",
      signal: AbortSignal.any([
        AbortSignal.timeout(25_000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
    const html = await response.text();
    signal?.throwIfAborted();
    const initial = parsePage(html);
    await store(initial.videos);
    let nextToken = initial.nextToken;
    const config = extractInnerTubeConfig(html);
    if (nextToken) {
      if (!config.apiKey || !config.context) {
        throw new Error(
          `Missing YouTube request configuration; ${label} sync is incomplete.`,
        );
      }
    }
    const requestedTokens = new Set();
    // Known videos never terminate the scan: older pages can contain database gaps.
    while (nextToken) {
      signal?.throwIfAborted();
      if (requestedTokens.has(nextToken)) {
        throw new Error(
          `YouTube repeated a continuation token; ${label} sync is incomplete.`,
        );
      }
      requestedTokens.add(nextToken);
      const page = await requestYouTubeApi(
        YOUTUBE.API.ENDPOINTS.BROWSE,
        config,
        {
          continuation: nextToken,
        },
        { signal },
      );
      if (!page.ok)
        throw new Error(
          `${label} continuation HTTP ${page.status}; sync is incomplete.`,
        );
      const parsed = parseContinuation(await page.json());
      await store(parsed.videos);
      result.pagesFetched++;
      nextToken = parsed.nextToken;
    }
    if (preview) return await summarizeSource(previewIds, provider, { signal });
    if (failedCount)
      throw new Error(
        `Could not store ${failedCount} ${label} videos; retry the sync.`,
      );
    result.videoCount = result.newCount;
    logger.info(
      `${label} sync completed: ${result.totalSeen} scanned, ${result.newCount} new, ${result.updatedCount} updated across ${result.pagesFetched + 1} pages.`,
    );
    return result;
  } finally {
    clearInterval(keepAlive);
  }
}

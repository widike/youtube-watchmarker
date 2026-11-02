// @ts-check

/**
 * Search action handlers
 * Handles video search and deletion
 */

import { logger } from "../shared/logger.js";
import { Search } from "../background/bg-search.js";
import { createHandler } from "../shared/handler-wrapper.js";
import { Database } from "../background/bg-database.js";
import { readWatchTime } from "../history/watch-time-storage.js";
import {
  durationStorage,
  durationBackfill,
} from "../background/duration-runtime.js";
import { enrichHistoryVideos } from "../history/history-video-statistics.js";

/**
 * Search for videos
 */
export const handleSearchVideos = createHandler(
  async (request) => {
    const query = request.query || "";
    const skip = Math.max(0, Math.floor(Number(request.offset) || 0));
    const length = Math.min(
      100,
      Math.max(1, Math.floor(Number(request.limit) || 50)),
    );

    const result = await Search.lookup(query, skip, length, {
      wordGroup: request.wordGroup,
      period: request.period,
      sort: request.sort,
    });

    const [time, durations] = await Promise.all([
      readWatchTime(Database.database),
      durationStorage.readCache(),
    ]);
    const videos = enrichHistoryVideos(result.videos, time, durations);
    await durationBackfill
      .requestVideos(videos)
      .catch((error) =>
        logger.warn("Duration refresh deferred:", error.message),
      );
    return {
      objVideos: videos,
      totalResults: result.totalResults,
    };
  },
  { name: "handleSearchVideos" },
);

/**
 * Delete a video from database and history
 */
export const handleSearchDelete = createHandler(
  async (request) => {
    const { videoId } = request;

    if (!videoId) {
      return { success: false, error: "Missing video ID" };
    }

    const result = await Search.delete(videoId, (progress) => {
      logger.debug("Delete progress:", progress);
    });

    return { success: true, ...result };
  },
  { name: "handleSearchDelete" },
);

// @ts-check

/**
 * Search action handlers
 * Handles video search and deletion
 */

import { logger } from "../logger.js";
import { Search } from "../bg-search.js";
import { createHandler } from "../handler-wrapper.js";

/**
 * Search for videos
 */
export const handleSearchVideos = createHandler(async (request) => {
  const query = request.query || "";
  const page = Number(request.page || 1);
  const pageSize = Number(request.pageSize || 50);
  const skip = Math.max(page - 1, 0) * pageSize;
  const length = pageSize;

  const result = await Search.lookup(query, skip, length);

  return {
    objVideos: result.videos,
    totalResults: result.totalResults,
  };
}, "handleSearchVideos");

/**
 * Delete a video from database and history
 */
export const handleSearchDelete = createHandler(async (request) => {
  const { videoId } = request;

  if (!videoId) {
    return { success: false, error: "Missing video ID" };
  }

  const success = await Search.delete(videoId, (progress) => {
    logger.debug("Delete progress:", progress);
  });

  return { success };
}, "handleSearchDelete");

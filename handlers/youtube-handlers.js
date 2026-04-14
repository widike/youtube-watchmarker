// @ts-check

/**
 * YouTube action handlers
 * Handles YouTube-related operations like lookup, ensure, synchronize
 */

import { logger } from "../logger.js";
import { Youtube } from "../bg-youtube.js";
import { videoTracker } from "../video-tracker.js";
import { createHandler } from "../handler-wrapper.js";

/**
 * Lookup a video in the database
 */
export const handleYoutubeLookup = createHandler(async (request) => {
  const { videoId, title } = request;

  if (!videoId) {
    return { success: false, error: "Missing video ID" };
  }

  if (title) {
    videoTracker.cacheTitle(videoId, title);
  }

  const result = await Youtube.lookup(videoId);
  return result || { success: false, error: "Video not found" };
}, "handleYoutubeLookup");

/**
 * Ensure a video exists in the database
 */
export const handleYoutubeEnsure = createHandler(async (request) => {
  const { videoId, title, timestamp, count } = request;

  if (!videoId) {
    return { success: false, error: "Missing video ID" };
  }

  if (title) {
    videoTracker.cacheTitle(videoId, title);
  }

  const result = await Youtube.ensure(videoId, title, timestamp, count);
  return { data: result };
}, "handleYoutubeEnsure");

/**
 * Synchronize YouTube history
 */
export const handleYoutubeSynchronize = createHandler(
  async () => {
    const result = await Youtube.synchronize((progress) => {
      logger.debug("YouTube sync progress:", progress);
    });

    const videoCount = result.videoCount || result.objVideos?.length || 0;
    return { response: result, videoCount };
  },
  { name: "handleYoutubeSynchronize", requiresRequest: false },
);

/**
 * Synchronize YouTube liked videos
 */
export const handleYoutubeLikedVideos = createHandler(
  async () => {
    const result = await Youtube.synchronizeLikedVideos((progress) => {
      logger.debug("Liked videos sync progress:", progress);
    });

    return { response: result, videoCount: result.videoCount || 0 };
  },
  { name: "handleYoutubeLikedVideos", requiresRequest: false },
);

/**
 * Mark a video as watched
 */
export const handleYoutubeMark = createHandler(async (request) => {
  const { videoId, title, timestamp, count } = request;

  if (!videoId) {
    return { success: false, error: "Missing video ID" };
  }

  const result = await Youtube.mark(videoId, title, timestamp, count);
  return { data: result };
}, "handleYoutubeMark");

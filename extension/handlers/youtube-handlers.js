// @ts-check

/**
 * YouTube action handlers
 * Handles YouTube-related operations like lookup, playback tracking, synchronize
 */

import { logger } from "../shared/logger.js";
import { Youtube } from "../sources/bg-youtube.js";
import { videoTracker } from "../background/video-tracker.js";
import { createHandler } from "../shared/handler-wrapper.js";

/**
 * Lookup a video in the database
 */
export const handleYoutubeLookup = createHandler(
  async (request) => {
    const { videoId } = request;

    if (!videoId) {
      return { success: false, error: "Missing video ID" };
    }

    const result = await Youtube.lookup(videoId);
    return result || { success: true, strIdent: null };
  },
  { name: "handleYoutubeLookup" },
);

/**
 * Synchronize YouTube history
 */
export const handleYoutubeSynchronize = createHandler(
  async () => {
    const result = await Youtube.synchronize((progress) => {
      logger.debug("YouTube sync progress:", progress);
    });

    const videoCount = result.videoCount ?? 0;
    return { response: result, videoCount };
  },
  { name: "handleYoutubeSynchronize" },
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
  { name: "handleYoutubeLikedVideos" },
);

export const handleYoutubeWatch = createHandler(
  async (request, sender) => ({
    data: await videoTracker.recordWatch(request, sender),
  }),
  { name: "handleYoutubeWatch" },
);

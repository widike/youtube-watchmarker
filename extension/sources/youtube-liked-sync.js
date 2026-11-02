import { YOUTUBE } from "../shared/constants.js";
import { synchronizeYouTubeSource } from "./youtube-source-sync.js";
import {
  parseLikedVideosResponse,
  parseLikedVideosContinuation,
} from "./youtube-liked-parser.js";

export function synchronizeLikedVideos(
  manager,
  onProgress,
  { preview = false, signal } = {},
) {
  return synchronizeYouTubeSource(manager, onProgress, {
    preview,
    signal,
    url: YOUTUBE.URLS.LIKED,
    label: "YouTube liked videos",
    parsePage: parseLikedVideosResponse,
    parseContinuation: parseLikedVideosContinuation,
    includeVideos: true,
  });
}

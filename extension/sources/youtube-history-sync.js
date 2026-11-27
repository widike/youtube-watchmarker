import { YOUTUBE } from "../shared/constants.js";
import { synchronizeYouTubeSource } from "./youtube-source-sync.js";
import {
  parseHistoryPageResponse,
  parseHistoryContinuationResponse,
} from "./youtube-history-parser.js";

export function synchronizeHistory(
  manager,
  onProgress,
  { preview = false, signal } = {},
) {
  return synchronizeYouTubeSource(manager, onProgress, {
    preview,
    historicalOnly: true,
    signal,
    url: YOUTUBE.URLS.HISTORY,
    label: "YouTube history",
    parsePage: parseHistoryPageResponse,
    parseContinuation: parseHistoryContinuationResponse,
  });
}

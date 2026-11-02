import { YOUTUBE } from "./constants.js";
import { synchronizeYouTubeSource } from "./youtube-source-sync.js";
import {
  parseHistoryPage,
  extractHistoryContinuationToken,
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
    parsePage: (html) => ({
      videos: parseHistoryPage(html),
      nextToken: extractHistoryContinuationToken(html),
    }),
    parseContinuation: parseHistoryContinuationResponse,
  });
}

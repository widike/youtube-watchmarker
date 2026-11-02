import { isValidVideoId } from "../shared/validation.js";
import { YOUTUBE } from "../shared/constants.js";
import { extractInnerTubeConfig } from "./youtube-page-data.js";
import {
  parseHistoryPageResponse,
  parseHistoryContinuationResponse,
} from "./youtube-history-parser.js";
import { requestYouTubeApi } from "./youtube-request.js";
import { getSapisidCookie } from "./youtube-auth.js";

// Checkpoint after each confirmed page, so old videos remain reachable across
// worker restarts. Absence is success only after the complete feed was read.
export async function deleteFromHistory(
  videoId,
  { state = {}, checkpoint = async () => {}, maxPages = 10, signal } = {},
) {
  if (!isValidVideoId(videoId)) throw new Error("Invalid video ID");
  const response = await fetch(YOUTUBE.URLS.HISTORY, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok)
    throw new Error(`Could not load YouTube history (HTTP ${response.status})`);
  const html = await response.text();
  let page = parseHistoryPageResponse(html);
  if (!(await getSapisidCookie()))
    throw new Error("YouTube sign-in cookie unavailable; sign in and retry.");
  const config = extractInnerTubeConfig(html);
  if (!config.apiKey || !config.context)
    throw new Error("Could not read YouTube request configuration");
  const account = `${config.authUser}:${config.delegatedSessionId || ""}`;
  if (state.account && state.account !== account)
    throw new Error(
      "Switch back to the YouTube account used for this deletion.",
    );
  state = { ...state, account };
  await checkpoint(state);
  let nextToken = state.nextToken;
  const seen = new Set(state.seen || []);
  for (let count = 0; count < maxPages; count++) {
    signal?.throwIfAborted();
    if (nextToken) {
      if (seen.has(nextToken))
        throw new Error("YouTube repeated a history continuation token");
      const continuation = await requestYouTubeApi(
        YOUTUBE.API.ENDPOINTS.BROWSE,
        config,
        { continuation: nextToken },
        { signal },
      );
      if (!continuation.ok) {
        if ([400, 410].includes(continuation.status))
          await checkpoint({ account });
        throw new Error(
          `YouTube history continuation HTTP ${continuation.status}`,
        );
      }
      page = parseHistoryContinuationResponse(await continuation.json());
      seen.add(nextToken);
    }
    const matches = page.deletionTargets.filter(
      (item) => item.videoId === videoId,
    );
    if (matches.some((item) => !item.tokens.length))
      throw new Error("YouTube did not provide a history deletion token");
    const tokens = [...new Set(matches.flatMap((item) => item.tokens))];
    if (tokens.length) {
      const feedback = await requestYouTubeApi(
        YOUTUBE.API.ENDPOINTS.FEEDBACK,
        config,
        {
          isFeedbackTokenUnencrypted: false,
          shouldMerge: false,
          feedbackTokens: tokens,
        },
        { signal },
      );
      if (!feedback.ok)
        throw new Error(
          `YouTube history delete failed (HTTP ${feedback.status})`,
        );
      const json = await feedback.json();
      if (
        json.error ||
        json.feedbackResponses?.length !== tokens.length ||
        json.feedbackResponses.some((item) => item.isProcessed !== true)
      )
        throw new Error("YouTube did not confirm the history deletion");
    }
    nextToken = page.nextToken;
    if (!nextToken) return { success: true };
    await checkpoint({ account, nextToken, seen: [...seen] });
  }
  return {
    success: false,
    error: "YouTube history deletion is still in progress.",
  };
}

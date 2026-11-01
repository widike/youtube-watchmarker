import { VIDEO_ID_LENGTH } from "./validation.js";
import { YOUTUBE } from "./constants.js";
import { logger } from "./logger.js";
import {
  extractInnerTubeConfig,
  extractHistoryFeedbackToken,
} from "./youtube-parser.js";
import { requestYouTubeApi } from "./youtube-request.js";

export async function deleteFromHistoryFirstPage(videoId) {
  if (
    !videoId ||
    typeof videoId !== "string" ||
    videoId.length !== VIDEO_ID_LENGTH
  ) {
    throw new Error("Invalid video ID");
  }

  const response = await fetch(YOUTUBE.URLS.HISTORY, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Could not load YouTube history (HTTP ${response.status})`);
  }

  const responseText = await response.text();
  const innerTube = extractInnerTubeConfig(responseText);
  const feedbackToken = extractHistoryFeedbackToken(responseText, videoId);

  if (!feedbackToken) {
    throw new Error("Video was not found on the first YouTube history page");
  }

  if (!innerTube.apiKey || !innerTube.context) {
    throw new Error("Could not read YouTube request configuration");
  }

  const feedbackResponse = await requestYouTubeApi(
    YOUTUBE.API.ENDPOINTS.FEEDBACK,
    innerTube,
    {
      isFeedbackTokenUnencrypted: false,
      shouldMerge: false,
      feedbackTokens: [feedbackToken],
    },
  );

  if (!feedbackResponse.ok) {
    throw new Error(
      `YouTube history delete failed (HTTP ${feedbackResponse.status})`,
    );
  }

  const feedbackJson = await feedbackResponse.json();
  const processed = feedbackJson?.feedbackResponses?.[0]?.isProcessed;
  if (processed !== true) {
    throw new Error("YouTube did not confirm the history deletion");
  }

  logger.info(`Deleted video ${videoId} from first YouTube history page`);
  return { success: true };
}

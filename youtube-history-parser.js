import { decodeHtmlEntitiesAndFixEncoding } from "./text-utils.js";
import { parseYouTubeDateText } from "./youtube-dates.js";
import { extractYtInitialData } from "./youtube-page-data.js";
import { savedEvent } from "./history-events.js";

const text = (value) =>
  value?.simpleText ||
  value?.content ||
  value?.text ||
  value?.runs?.map((run) => run.text || "").join("") ||
  "";

function historyContents(html) {
  const data = extractYtInitialData(html);
  if (
    !data ||
    data.responseContext?.mainAppWebResponseContext?.loggedOut === true
  ) {
    throw new Error(
      "Could not read YouTube history. Sign in to youtube.com and retry.",
    );
  }
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const selected = tabs.find((tab) => tab.tabRenderer?.selected)?.tabRenderer;
  const content =
    selected?.content ||
    tabs.find((tab) => tab.tabRenderer?.content)?.tabRenderer.content;
  const contents = content?.sectionListRenderer?.contents;
  if (!Array.isArray(contents)) {
    throw new Error(
      "Could not read the YouTube history feed; sync is incomplete.",
    );
  }
  return contents;
}

function sectionTimestamp(node, inherited) {
  const header = node.itemSectionRenderer?.header;
  return (
    parseYouTubeDateText(text(header?.itemSectionHeaderRenderer?.title)) ||
    inherited
  );
}

function sourceVideo(node, timestamp) {
  const lockup = node.lockupViewModel;
  if (
    lockup &&
    lockup.contentType &&
    lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO"
  )
    return null;
  const shorts = node.shortsLockupViewModel;
  const renderer = node.videoRenderer || node.reelItemRenderer;
  const id =
    lockup?.contentId ||
    renderer?.videoId ||
    shorts?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return null;
  const title =
    text(lockup?.metadata?.lockupMetadataViewModel?.title) ||
    text(renderer?.title) ||
    text(renderer?.headline) ||
    text(shorts?.overlayMetadata?.primaryText);
  const video = {
    strIdent: id,
    intTimestamp: timestamp,
    strTitle: decodeHtmlEntitiesAndFixEncoding(title),
    intCount: 1,
  };
  return {
    ...video,
    watchEvents: savedEvent(video).map((event) => ({
      ...event,
      precision: "day",
    })),
  };
}

// Only walk the feed body, never page sidebars, menus or recommendation endpoints.
function walkFeed(node, visit, timestamp = null) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkFeed(item, visit, timestamp);
    return;
  }
  timestamp = sectionTimestamp(node, timestamp);
  const video = sourceVideo(node, timestamp);
  if (video) {
    visit({ video, node });
    return;
  }
  const token =
    node.continuationItemRenderer?.continuationEndpoint?.continuationCommand
      ?.token;
  if (token) {
    visit({ token });
    return;
  }
  // Video cards contain menus, watch endpoints and suggested videos, not feed children.
  if (
    node.videoRenderer ||
    node.lockupViewModel ||
    node.shortsLockupViewModel ||
    node.reelItemRenderer
  )
    return;
  for (const key of [
    "itemSectionRenderer",
    "sectionListRenderer",
    "richItemRenderer",
    "richSectionRenderer",
    "shelfRenderer",
    "reelShelfRenderer",
    "richShelfRenderer",
    "horizontalListRenderer",
    "expandedShelfContentsRenderer",
    "gridRenderer",
    "contents",
    "items",
    "content",
  ]) {
    if (node[key]) walkFeed(node[key], visit, timestamp);
  }
}

function parseContents(contents) {
  const videos = [];
  const deletionTargets = [];
  let nextToken = null;
  walkFeed(contents, ({ video, node, token }) => {
    if (video) {
      videos.push(video);
      deletionTargets.push({
        videoId: video.strIdent,
        tokens: [...findFeedbackTokens(node)],
      });
    }
    if (token) nextToken = token;
  });
  return { videos, nextToken, deletionTargets };
}

export function parseHistoryPageResponse(html) {
  return parseContents(historyContents(html));
}

export function parseHistoryPage(html) {
  return parseContents(historyContents(html)).videos;
}

export function extractHistoryContinuationToken(html) {
  return parseContents(historyContents(html)).nextToken;
}

export function parseHistoryContinuationResponse(json) {
  if (json?.error)
    throw new Error("YouTube returned a history continuation error.");
  const actions = [
    ...(json?.onResponseReceivedActions || []),
    ...(json?.onResponseReceivedEndpoints || []),
  ];
  const items = actions.flatMap(
    (action) =>
      action.appendContinuationItemsAction?.continuationItems ||
      action.reloadContinuationItemsCommand?.continuationItems ||
      [],
  );
  if (
    !actions.some(
      (action) =>
        Array.isArray(
          action.appendContinuationItemsAction?.continuationItems,
        ) ||
        Array.isArray(action.reloadContinuationItemsCommand?.continuationItems),
    )
  ) {
    throw new Error(
      "Could not read the YouTube history continuation; sync is incomplete.",
    );
  }
  return parseContents(items);
}

function findFeedbackTokens(node, tokens = new Set(), removal = false) {
  if (!node || typeof node !== "object") return tokens;
  const icon = node.icon?.iconType || node.iconName;
  removal ||= ["DELETE", "CLOSE", "REMOVE", "REMOVE_FROM_HISTORY"].includes(
    icon,
  );
  if (removal && node.feedbackEndpoint?.feedbackToken)
    tokens.add(node.feedbackEndpoint.feedbackToken);
  for (const value of Object.values(node)) {
    findFeedbackTokens(value, tokens, removal);
  }
  return tokens;
}

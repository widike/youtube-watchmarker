import { decodeHtmlEntitiesAndFixEncoding } from "../shared/text-utils.js";
import { extractYtInitialData } from "./youtube-page-data.js";

const text = (value) =>
  value?.simpleText ||
  value?.content ||
  value?.runs?.map((run) => run.text || "").join("") ||
  "";

function parseItems(items) {
  const videos = [];
  let nextToken = null;
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    const token =
      item.continuationItemRenderer?.continuationEndpoint?.continuationCommand
        ?.token;
    if (token) {
      nextToken = token;
      return;
    }
    const card = item.richItemRenderer?.content || item;
    const renderer = card.playlistVideoRenderer || card.videoRenderer;
    const lockup = card.lockupViewModel;
    if (
      lockup?.contentType &&
      lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO"
    )
      return;
    const id = renderer?.videoId || lockup?.contentId;
    if (typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
      videos.push({
        strIdent: id,
        // A playlist video's upload date is not a like/watch timestamp.
        intTimestamp: null,
        strTitle: decodeHtmlEntitiesAndFixEncoding(
          text(renderer?.title) ||
            text(lockup?.metadata?.lockupMetadataViewModel?.title),
        ),
        intCount: 1,
      });
      return;
    }
    // Stay inside the selected playlist's feed; never walk card menus,
    // watch endpoints, sidebars, or recommendations attached to a video.
    if (renderer || lockup) return;
    for (const key of [
      "itemSectionRenderer",
      "sectionListRenderer",
      "richSectionRenderer",
      "richShelfRenderer",
      "playlistVideoListRenderer",
      "richGridRenderer",
      "contents",
      "content",
    ]) {
      const value = card[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value) visit(value);
    }
  };
  items.forEach(visit);
  return { videos, nextToken };
}

export function parseLikedVideosResponse(html) {
  const data = extractYtInitialData(html);
  if (
    !data ||
    data.responseContext?.mainAppWebResponseContext?.loggedOut === true
  ) {
    throw new Error(
      "Could not read liked videos. Sign in to youtube.com and retry.",
    );
  }
  if (data.alerts?.some((alert) => alert.alertRenderer?.type === "ERROR")) {
    throw new Error("YouTube could not load liked videos; sync is incomplete.");
  }
  const tabs =
    (
      data.contents?.twoColumnBrowseResultsRenderer ||
      data.contents?.singleColumnBrowseResultsRenderer
    )?.tabs || [];
  const tab =
    tabs.find((entry) => entry.tabRenderer?.selected) ||
    tabs.find((entry) => entry.tabRenderer?.content);
  // The selected feed can contain video cards directly in its sections.
  // Read the whole feed body, excluding headers, sidebars and other tabs.
  const content = tab?.tabRenderer?.content;
  const list =
    content?.sectionListRenderer ||
    content?.richGridRenderer ||
    content?.playlistVideoListRenderer;
  if (!Array.isArray(list?.contents)) {
    throw new Error(
      "Could not read the liked videos playlist; sync is incomplete.",
    );
  }
  return parseItems(list.contents);
}

export function parseLikedVideosPage(html) {
  return parseLikedVideosResponse(html).videos;
}

export function parseLikedVideosContinuation(json) {
  if (
    json?.error ||
    json?.alerts?.some((alert) => alert.alertRenderer?.type === "ERROR") ||
    json?.responseContext?.mainAppWebResponseContext?.loggedOut === true
  ) {
    throw new Error(
      "YouTube returned a liked videos continuation error; sign in and retry.",
    );
  }
  const actions = [
    ...(json?.onResponseReceivedActions || []),
    ...(json?.onResponseReceivedEndpoints || []),
  ];
  const batches = actions
    .flatMap((action) => [
      action.appendContinuationItemsAction?.continuationItems,
      action.reloadContinuationItemsCommand?.continuationItems,
    ])
    .filter(Array.isArray);
  if (!batches.length) {
    throw new Error(
      "Could not read the liked videos continuation; sync is incomplete.",
    );
  }
  return parseItems(batches.flat());
}

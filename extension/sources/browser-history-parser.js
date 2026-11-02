import { normalizeVideoTitle } from "../shared/text-utils.js";
import { isValidVideoId, isValidVideoTitle } from "../shared/validation.js";
import { mergeEvents, savedEvent } from "../history/history-events.js";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

export function extractHistoryVideoId(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    let id = null;
    if (url.hostname === "youtu.be") {
      id = url.pathname.match(/^\/([^/]+)\/?$/)?.[1];
    } else if (YOUTUBE_HOSTS.has(url.hostname)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else id = url.pathname.match(/^\/shorts\/([^/]+)\/?$/)?.[1];
    }
    return isValidVideoId(id) ? id : null;
  } catch {
    return null;
  }
}

export function cleanHistoryTitle(value) {
  if (typeof value !== "string") return "";
  const title = normalizeVideoTitle(value)
    .replace(/\s+-\s+YouTube\s*$/i, "")
    .trim();
  return isValidVideoTitle(title) ? title : "";
}

// Multiple URLs can point to one video. Merge before checking skipExisting so an
// older URL cannot prevent importing a newer visit or a useful title.
export function mergeHistoryItem(videos, item, videoId) {
  const existing = videos.get(videoId);
  const title = cleanHistoryTitle(item.title);
  const timestamp = item.lastVisitTime;
  const count =
    Number.isFinite(item.visitCount) && item.visitCount >= 1
      ? Math.floor(item.visitCount)
      : 1;
  videos.set(videoId, {
    strIdent: videoId,
    intTimestamp: Math.max(existing?.intTimestamp || 0, timestamp),
    strTitle:
      timestamp >= (existing?.intTimestamp || 0) && title
        ? title
        : existing?.strTitle || title,
    intCount: Math.max(existing?.intCount || 1, count),
    watchEvents: mergeEvents(
      existing?.watchEvents || [],
      savedEvent({ strIdent: videoId, intTimestamp: timestamp }),
    ),
  });
}

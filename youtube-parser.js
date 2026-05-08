// @ts-check

/**
 * YouTube Parser
 * Handles parsing YouTube page data to extract video information
 * Separates parsing logic from database operations
 */

import { decodeHtmlEntitiesAndFixEncoding } from "./text-utils.js";
import { VIDEO_ID_LENGTH } from "./validation.js";
import { logger } from "./logger.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES =
  "jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december";

/**
 * Helper function to safely extract nested property
 * @param {Object} obj - Source object
 * @param {string} path - Dot-separated path
 * @returns {*} Value at path or null
 */
export function getNestedProperty(obj, path) {
  return path.split(".").reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

/**
 * Extract video title from various YouTube data structures
 * @param {Object} videoRenderer - Video renderer object
 * @returns {string|null} Extracted title or null
 */
export function extractVideoTitle(videoRenderer) {
  const titlePaths = [
    "title.runs.0.text",
    "title.simpleText",
    "title.text",
    "headline.runs.0.text",
    "headline.simpleText",
    "longBylineText.runs.0.text",
    "shortBylineText.runs.0.text",
    "accessibility.accessibilityData.label",
  ];

  for (const path of titlePaths) {
    const title = getNestedProperty(videoRenderer, path);
    if (title && typeof title === "string" && title.trim()) {
      let cleanTitle = title.trim();
      cleanTitle = cleanTitle.replace(/\s+by\s+[^,]*$/i, "").trim();
      cleanTitle = cleanTitle.replace(/\s*-\s*YouTube\s*$/i, "").trim();
      return cleanTitle;
    }
  }

  return null;
}

function startOfLocalDay(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/**
 * Parse common YouTube date labels into a timestamp.
 * @param {string|null} dateText - YouTube date label
 * @param {Date} [now] - Reference date
 * @returns {number|null} Timestamp in milliseconds, or null when unknown
 */
export function parseYouTubeDateText(dateText, now = new Date()) {
  if (!dateText || typeof dateText !== "string") {
    return null;
  }

  const text = decodeHtmlEntitiesAndFixEncoding(dateText)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  const lowerText = text.toLowerCase();

  if (lowerText.includes("today") || lowerText.includes("heute")) {
    return startOfLocalDay(now);
  }

  if (lowerText.includes("yesterday") || lowerText.includes("gestern")) {
    return startOfLocalDay(new Date(now.getTime() - DAY_IN_MS));
  }

  let relativeMatch = lowerText.match(
    /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/,
  );
  let relativeUnit = relativeMatch?.[2] || null;

  if (!relativeMatch) {
    relativeMatch = lowerText.match(
      /vor\s+(\d+)\s+(sekunde|minute|stunde|tag|woche|monat|jahr)(?:n|en|e)?/,
    );
    const germanUnits = {
      sekunde: "second",
      minute: "minute",
      stunde: "hour",
      tag: "day",
      woche: "week",
      monat: "month",
      jahr: "year",
    };
    relativeUnit = germanUnits[relativeMatch?.[2]] || null;
  }

  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unit = relativeUnit;
    const multipliers = {
      second: 1000,
      minute: 60 * 1000,
      hour: 60 * 60 * 1000,
      day: DAY_IN_MS,
      week: 7 * DAY_IN_MS,
      month: 30 * DAY_IN_MS,
      year: 365 * DAY_IN_MS,
    };
    const timestamp = now.getTime() - amount * multipliers[unit];
    return unit === "second" || unit === "minute" || unit === "hour"
      ? timestamp
      : startOfLocalDay(new Date(timestamp));
  }

  const absoluteText = text
    .replace(/^(added|watched|viewed|liked)\s+(on\s+)?/i, "")
    .trim();

  const monthDayMatch = absoluteText.match(
    new RegExp(`^(${MONTH_NAMES})\\.?\\s+\\d{1,2}$`, "i"),
  );
  const candidateText = monthDayMatch
    ? `${absoluteText}, ${now.getFullYear()}`
    : absoluteText;
  let parsedDate = new Date(candidateText);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  if (monthDayMatch && parsedDate.getTime() > now.getTime() + DAY_IN_MS) {
    parsedDate = new Date(`${absoluteText}, ${now.getFullYear() - 1}`);
  }

  return startOfLocalDay(parsedDate);
}

function extractSectionTimestamp(section) {
  const headerPaths = [
    "itemSectionRenderer.header.itemSectionHeaderRenderer.title.simpleText",
    "itemSectionRenderer.header.itemSectionHeaderRenderer.title.runs.0.text",
    "itemSectionRenderer.header.feedFilterChipBarRenderer.contents.0.chipCloudChipRenderer.text.simpleText",
  ];

  for (const path of headerPaths) {
    const dateText = getNestedProperty(section, path);
    const timestamp = parseYouTubeDateText(dateText);
    if (timestamp) {
      return timestamp;
    }
  }

  return null;
}

/**
 * Extract videos from YouTube contents array (JSON data structure)
 * @param {Array} contents - Contents array from YouTube data
 * @returns {Array} Array of video objects
 */
export function extractVideosFromContents(contents) {
  const videos = [];
  if (contents && Array.isArray(contents)) {
    for (const section of contents) {
      const sectionTimestamp = extractSectionTimestamp(section);
      const items = getNestedProperty(section, "itemSectionRenderer.contents");
      if (items && Array.isArray(items)) {
        for (const item of items) {
          // Try lockupViewModel format first (new format)
          const lockupViewModel = item.lockupViewModel;
          if (lockupViewModel) {
            const contentId = lockupViewModel.contentId;
            const metadata = lockupViewModel.metadata?.lockupMetadataViewModel;
            const title = metadata?.title?.content || metadata?.title?.text;

            if (contentId && contentId.length === VIDEO_ID_LENGTH && title) {
              videos.push({
                strIdent: contentId,
                intTimestamp: sectionTimestamp,
                strTitle: decodeHtmlEntitiesAndFixEncoding(title),
                intCount: 1,
              });
              continue;
            }
          }

          // Fallback to videoRenderer format (old format)
          const videoRenderer = item.videoRenderer;
          if (videoRenderer && videoRenderer.videoId) {
            const videoId = videoRenderer.videoId;
            const title = extractVideoTitle(videoRenderer);

            if (videoId && videoId.length === VIDEO_ID_LENGTH && title) {
              videos.push({
                strIdent: videoId,
                intTimestamp: sectionTimestamp,
                strTitle: decodeHtmlEntitiesAndFixEncoding(title),
                intCount: 1,
              });
            }
          }
        }
      }
    }
  }
  return videos;
}

/**
 * Extract a balanced JSON object starting at the opening brace at startIdx.
 * Handles strings (and escapes) so braces inside strings don't break nesting.
 * @param {string} text
 * @param {number} startIdx - Index of the opening '{'
 * @returns {string|null} JSON object substring, or null if unbalanced
 */
function extractBalancedObject(text, startIdx) {
  if (text[startIdx] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

/**
 * Extract the InnerTube API key and request context from a YouTube HTML page.
 * Both values are needed to call /youtubei/v1/browse for paginated continuation.
 * @param {string} responseText - Raw HTML response
 * @returns {{apiKey: string|null, context: Object|null, clientName: string|null, clientVersion: string|null}}
 */
export function extractInnerTubeConfig(responseText) {
  let apiKey = null;
  let context = null;
  let clientName = null;
  let clientVersion = null;

  const apiKeyMatch = responseText.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
  if (apiKeyMatch) {
    apiKey = apiKeyMatch[1];
  }

  const ctxIdx = responseText.indexOf('"INNERTUBE_CONTEXT":');
  if (ctxIdx >= 0) {
    const objStart = responseText.indexOf("{", ctxIdx);
    if (objStart >= 0) {
      const objStr = extractBalancedObject(responseText, objStart);
      if (objStr) {
        try {
          context = JSON.parse(objStr);
          clientName = context?.client?.clientName || null;
          clientVersion = context?.client?.clientVersion || null;
        } catch (error) {
          logger.warn("Failed to parse INNERTUBE_CONTEXT:", error);
        }
      }
    }
  }

  if (!clientName) {
    const m = responseText.match(/"INNERTUBE_CLIENT_NAME":\s*"([^"]+)"/);
    if (m) clientName = m[1];
  }
  if (!clientVersion) {
    const m = responseText.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/);
    if (m) clientVersion = m[1];
  }

  return { apiKey, context, clientName, clientVersion };
}

/**
 * Extract the continuation token from the initial history page's section list.
 * @param {string} responseText - Raw HTML response
 * @returns {string|null} Continuation token, or null if absent
 */
export function extractHistoryContinuationToken(responseText) {
  const dataMatch = responseText.match(/var\s+ytInitialData\s*=\s*({.+?});/s);
  if (!dataMatch) {
    return null;
  }
  try {
    const ytInitialData = JSON.parse(dataMatch[1]);
    const sections = getNestedProperty(
      ytInitialData,
      "contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents",
    );
    if (!Array.isArray(sections)) {
      return null;
    }
    for (const section of sections) {
      const token = getNestedProperty(
        section,
        "continuationItemRenderer.continuationEndpoint.continuationCommand.token",
      );
      if (token) {
        return token;
      }
    }
  } catch (error) {
    logger.warn("Failed to parse ytInitialData for continuation token:", error);
  }
  return null;
}

/**
 * Parse a /youtubei/v1/browse continuation response, returning the videos
 * contained in this page and the next continuation token (if any).
 * @param {Object} json - Parsed JSON response
 * @returns {{videos: Array, nextToken: string|null}}
 */
export function parseHistoryContinuationResponse(json) {
  const actions =
    json?.onResponseReceivedActions || json?.onResponseReceivedEndpoints || [];
  let items = [];
  for (const action of actions) {
    const append = action.appendContinuationItemsAction;
    if (append && Array.isArray(append.continuationItems)) {
      items = items.concat(append.continuationItems);
    }
    const reload = action.reloadContinuationItemsCommand;
    if (reload && Array.isArray(reload.continuationItems)) {
      items = items.concat(reload.continuationItems);
    }
  }

  const videos = extractVideosFromContents(items);

  let nextToken = null;
  for (const item of items) {
    const token = getNestedProperty(
      item,
      "continuationItemRenderer.continuationEndpoint.continuationCommand.token",
    );
    if (token) {
      nextToken = token;
    }
  }

  return { videos, nextToken };
}

/**
 * Parse YouTube history page HTML to extract videos
 * @param {string} responseText - Raw HTML response
 * @returns {Array} Array of video objects
 */
export function parseHistoryPage(responseText) {
  let videos = [];

  const cleanedText = responseText
    .replaceAll('\\"', "\\u0022")
    .replaceAll("\r", "")
    .replaceAll("\n", "");

  // Try to find and parse the main data structure
  const dataRegex = /var\s+ytInitialData\s*=\s*({.+?});/s;
  const dataMatch = responseText.match(dataRegex);

  if (dataMatch) {
    try {
      const ytInitialData = JSON.parse(dataMatch[1]);

      // Navigate through the YouTube data structure
      const contents = getNestedProperty(
        ytInitialData,
        "contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents",
      );

      // Extract videos from first page
      videos = extractVideosFromContents(contents);
    } catch (jsonError) {
      logger.warn("Failed to parse ytInitialData:", jsonError);
    }
  }

  // Fallback: Parse new yt-lockup-view-model format from HTML
  if (videos.length === 0) {
    const lockupRegex =
      /<yt-lockup-view-model[^>]*>[\s\S]*?content-id-([a-zA-Z0-9_-]{11})[\s\S]*?<\/yt-lockup-view-model>/g;
    let lockupMatch;

    while ((lockupMatch = lockupRegex.exec(responseText)) !== null) {
      try {
        const videoId = lockupMatch[1];
        const lockupHtml = lockupMatch[0];

        // Extract title from the link text
        const titleMatch = lockupHtml.match(
          /<span class="yt-core-attributed-string[^"]*"[^>]*>([^<]+)<\/span>/,
        );
        let title = titleMatch ? titleMatch[1] : null;

        // Try alternative title extraction
        if (!title) {
          const altTitleMatch = lockupHtml.match(/title="([^"]+)"/);
          title = altTitleMatch ? altTitleMatch[1] : null;
        }

        if (title && !videos.some((video) => video.strIdent === videoId)) {
          videos.push({
            strIdent: videoId,
            intTimestamp: null,
            strTitle: decodeHtmlEntitiesAndFixEncoding(title),
            intCount: 1,
          });
        }
      } catch (error) {
        logger.warn("Error parsing yt-lockup-view-model:", error);
      }
    }
  }

  // Fallback: Use regex for old videoRenderer format
  if (videos.length === 0) {
    const videoRendererRegex = /"videoRenderer":\s*({[^}]*"videoId"[^}]*})/g;
    let rendererMatch;

    while ((rendererMatch = videoRendererRegex.exec(cleanedText)) !== null) {
      try {
        const rendererStr = rendererMatch[1];

        // Extract video ID
        const videoIdMatch = rendererStr.match(/"videoId":\s*"([^"]{11})"/);
        if (!videoIdMatch) continue;

        const videoId = videoIdMatch[1];

        // Extract title using multiple patterns
        const titlePatterns = [
          /"title":\s*{\s*"runs":\s*\[{\s*"text":\s*"([^"]+)"/,
          /"title":\s*{\s*"simpleText":\s*"([^"]+)"/,
          /"text":\s*"([^"]+)"/,
        ];

        let title = null;
        for (const pattern of titlePatterns) {
          const titleMatch = rendererStr.match(pattern);
          if (titleMatch && titleMatch[1]) {
            title = titleMatch[1];
            break;
          }
        }

        if (title && !videos.some((video) => video.strIdent === videoId)) {
          videos.push({
            strIdent: videoId,
            intTimestamp: null,
            strTitle: decodeHtmlEntitiesAndFixEncoding(title),
            intCount: 1,
          });
        }
      } catch (error) {
        logger.warn("Error parsing video renderer:", error);
      }
    }
  }

  return videos;
}

/**
 * Parse YouTube liked videos page HTML to extract videos
 * @param {string} responseText - Raw HTML response
 * @returns {Array} Array of video objects
 */
export function parseLikedVideosPage(responseText) {
  const videos = [];

  const cleanedText = responseText
    .replaceAll('\\"', "\\u0022")
    .replaceAll("\r", "")
    .replaceAll("\n", "");

  // Extract liked videos with detailed regex (with date)
  const objVideoWithDate = new RegExp(
    '"playlistVideoRenderer":[^"]*"videoId":[^"]*"([^"]{11})"' + // videoId
      '.*?"title":[^"]*"runs":[^"]*"text":[^"]*"([^"]*)"' + // title
      '.*?"videoSecondaryInfoRenderer".*?"dateText":[^"]*"simpleText":[^"]*"([^"]*)"', // dateAdded
    "g",
  );

  let objMatch;
  while ((objMatch = objVideoWithDate.exec(cleanedText)) !== null) {
    if (objMatch[1] && objMatch[2]) {
      videos.push({
        strIdent: objMatch[1],
        intTimestamp: parseYouTubeDateText(objMatch[3]),
        strTitle: decodeHtmlEntitiesAndFixEncoding(objMatch[2]),
        intCount: 1,
      });
    }
  }

  // Fallback: Simpler pattern without date
  if (videos.length === 0) {
    const objVideoSimple = new RegExp(
      '"playlistVideoRenderer":[^"]*"videoId":[^"]*"([^"]{11})"' + // videoId
        '.*?"title":[^"]*"runs":[^"]*"text":[^"]*"([^"]*)"', // title
      "g",
    );

    while ((objMatch = objVideoSimple.exec(cleanedText)) !== null) {
      if (objMatch[1] && objMatch[2]) {
        videos.push({
          strIdent: objMatch[1],
          intTimestamp: null,
          strTitle: decodeHtmlEntitiesAndFixEncoding(objMatch[2]),
          intCount: 1,
        });
      }
    }
  }

  return videos;
}

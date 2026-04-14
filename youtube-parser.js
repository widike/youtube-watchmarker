// @ts-check

/**
 * YouTube Parser
 * Handles parsing YouTube page data to extract video information
 * Separates parsing logic from database operations
 */

import { decodeHtmlEntitiesAndFixEncoding } from "./text-utils.js";
import { VIDEO_ID_LENGTH } from "./validation.js";
import { logger } from "./logger.js";

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

/**
 * Extract videos from YouTube contents array (JSON data structure)
 * @param {Array} contents - Contents array from YouTube data
 * @returns {Array} Array of video objects
 */
export function extractVideosFromContents(contents) {
  const videos = [];
  if (contents && Array.isArray(contents)) {
    for (const section of contents) {
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
                intTimestamp: Date.now(),
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
                intTimestamp: Date.now(),
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
            intTimestamp: Date.now(),
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
            intTimestamp: Date.now(),
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
        intTimestamp: Date.now(),
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
          intTimestamp: Date.now(),
          strTitle: decodeHtmlEntitiesAndFixEncoding(objMatch[2]),
          intCount: 1,
        });
      }
    }
  }

  return videos;
}

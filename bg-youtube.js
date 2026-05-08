import { isValidVideoTitle, VIDEO_ID_LENGTH } from "./validation.js";
import { TIMEOUTS, YOUTUBE } from "./constants.js";
import { logger } from "./logger.js";
import {
  extractHistoryContinuationToken,
  extractInnerTubeConfig,
  parseHistoryContinuationResponse,
  parseHistoryPage,
  parseLikedVideosPage,
} from "./youtube-parser.js";

const YOUTUBE_ORIGIN = "https://www.youtube.com";
const SAPISID_COOKIE_NAMES = [
  "SAPISID",
  "__Secure-3PAPISID",
  "__Secure-1PAPISID",
];
const HISTORY_MAX_CONTINUATION_PAGES = 500;

async function readCookieValue(name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: YOUTUBE_ORIGIN, name }, (cookie) => {
      if (chrome.runtime.lastError) {
        logger.warn(
          `Cookie read error for ${name}:`,
          chrome.runtime.lastError.message,
        );
        resolve(null);
        return;
      }
      resolve(cookie?.value || null);
    });
  });
}

async function getSapisidCookie() {
  for (const name of SAPISID_COOKIE_NAMES) {
    const value = await readCookieValue(name);
    if (value) return value;
  }
  return null;
}

async function computeSapisidHash(sapisid, origin = YOUTUBE_ORIGIN) {
  const ts = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(`${ts} ${sapisid} ${origin}`);
  const digest = await crypto.subtle.digest("SHA-1", data);
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `SAPISIDHASH ${ts}_${hash}`;
}

/**
 * YouTube management class
 * Handles YouTube history sync, liked videos, and video operations
 */
export class YoutubeManager {
  constructor() {
    this.isInitialized = false;
    this.providerFactory = null;
  }

  /**
   * Set the provider factory for dependency injection
   * @param {Object} factory - Database provider factory instance
   */
  setProviderFactory(factory) {
    this.providerFactory = factory;
  }

  /**
   * Get the current database provider
   * @returns {Object} Database provider
   * @throws {Error} If provider factory not set
   */
  getProvider() {
    if (!this.providerFactory) {
      throw new Error(
        "Provider factory not set. Call setProviderFactory() first.",
      );
    }
    const provider = this.providerFactory.getCurrentProvider();
    if (!provider) {
      throw new Error("No current database provider available");
    }
    return provider;
  }

  /**
   * Initialize the YouTube module
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    logger.debug("YouTube module initialized");
  }

  getSourceTimestamp(video) {
    const timestamp = Number(video?.intTimestamp);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }

  selectTitle(existingTitle = "", sourceTitle = "") {
    if (sourceTitle && isValidVideoTitle(sourceTitle)) {
      return sourceTitle;
    }

    if (!isValidVideoTitle(existingTitle) && sourceTitle) {
      return sourceTitle;
    }

    return existingTitle || "";
  }

  /**
   * Upsert a parsed source video without overwriting existing timestamps with
   * fallback dates.
   * @param {Object} currentProvider - Database provider
   * @param {Object} video - Parsed video
   * @returns {Promise<{status: string, video?: Object}>} Upsert result
   */
  async upsertSourceVideo(currentProvider, video) {
    const sourceTimestamp = this.getSourceTimestamp(video);
    const existingVideo = await currentProvider.getVideo(video.strIdent);

    if (!existingVideo) {
      const newVideo = {
        strIdent: video.strIdent,
        intTimestamp: sourceTimestamp || Date.now(),
        strTitle: this.selectTitle("", video.strTitle),
        intCount: video.intCount || 1,
      };

      await currentProvider.putVideo(newVideo);
      return { status: "created", video: newVideo };
    }

    const existingTimestamp = this.getSourceTimestamp(existingVideo);
    const mergedTimestamp =
      existingTimestamp && sourceTimestamp
        ? Math.max(existingTimestamp, sourceTimestamp)
        : existingTimestamp || sourceTimestamp;
    const mergedVideo = {
      strIdent: existingVideo.strIdent,
      intTimestamp: mergedTimestamp || Date.now(),
      strTitle: this.selectTitle(existingVideo.strTitle, video.strTitle),
      intCount: Math.max(existingVideo.intCount || 1, video.intCount || 1),
    };

    const changed =
      mergedVideo.intTimestamp !== existingVideo.intTimestamp ||
      mergedVideo.strTitle !== (existingVideo.strTitle || "") ||
      mergedVideo.intCount !== (existingVideo.intCount || 1);

    if (!changed) {
      return { status: "skipped" };
    }

    await currentProvider.putVideo(mergedVideo);
    return { status: "updated", video: mergedVideo };
  }

  /**
   * Synchronize YouTube watch history. Walks the InnerTube continuation
   * pagination so the full history is imported, not just the first page.
   * @param {Function} [onProgress] - Optional progress callback
   * @returns {Promise<Object>} Synchronization result
   */
  async synchronize(onProgress = null) {
    try {
      const currentProvider = this.getProvider();
      logger.info("Starting YouTube history sync (with pagination)...");

      const response = await fetch(YOUTUBE.URLS.HISTORY, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseText = await response.text();

      const initialVideos = parseHistoryPage(responseText);
      const innerTube = extractInnerTubeConfig(responseText);
      const initialContinuationToken =
        extractHistoryContinuationToken(responseText);

      let processedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let totalSeen = 0;
      let pagesFetched = 0;

      const upsertVideos = async (videos) => {
        for (const video of videos) {
          try {
            const upsertResult = await this.upsertSourceVideo(
              currentProvider,
              video,
            );
            if (upsertResult.status === "created") {
              processedCount++;
            } else if (upsertResult.status === "updated") {
              updatedCount++;
            } else {
              skippedCount++;
            }
            totalSeen++;

            const changedSoFar = processedCount + updatedCount;
            if (changedSoFar > 0 && changedSoFar % 25 === 0 && onProgress) {
              onProgress({
                strProgress: `processed ${changedSoFar} YouTube videos`,
              });
            }
          } catch (error) {
            logger.error(`Error storing video ${video.strIdent}:`, error);
          }
        }
      };

      await upsertVideos(initialVideos);

      if (initialContinuationToken && innerTube.apiKey && innerTube.context) {
        const sapisid = await getSapisidCookie();
        if (!sapisid) {
          logger.warn(
            "No SAPISID cookie found; cannot paginate YouTube history. " +
              "Make sure you are signed in to youtube.com.",
          );
        } else {
          const browseUrl = `${YOUTUBE.API.BASE}${YOUTUBE.API.ENDPOINTS.BROWSE}?key=${encodeURIComponent(innerTube.apiKey)}&prettyPrint=false`;
          let nextToken = initialContinuationToken;

          while (nextToken && pagesFetched < HISTORY_MAX_CONTINUATION_PAGES) {
            pagesFetched++;
            const auth = await computeSapisidHash(sapisid);
            const headers = {
              "Content-Type": "application/json",
              Authorization: auth,
              "X-Origin": YOUTUBE_ORIGIN,
              "X-Goog-AuthUser": "0",
            };
            if (innerTube.clientVersion) {
              headers["X-Youtube-Client-Version"] = innerTube.clientVersion;
            }

            let pageJson;
            try {
              const pageResp = await fetch(browseUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  context: innerTube.context,
                  continuation: nextToken,
                }),
                credentials: "include",
              });
              if (!pageResp.ok) {
                logger.warn(
                  `History continuation page ${pagesFetched} HTTP ${pageResp.status}; stopping pagination.`,
                );
                break;
              }
              pageJson = await pageResp.json();
            } catch (error) {
              logger.error(
                `History continuation fetch error on page ${pagesFetched}:`,
                error,
              );
              break;
            }

            const { videos: pageVideos, nextToken: nt } =
              parseHistoryContinuationResponse(pageJson);

            if (pageVideos.length === 0 && !nt) {
              logger.info(
                `Continuation page ${pagesFetched} returned no items; stopping.`,
              );
              break;
            }

            await upsertVideos(pageVideos);
            nextToken = nt;
          }

          if (pagesFetched >= HISTORY_MAX_CONTINUATION_PAGES && nextToken) {
            logger.warn(
              `Reached max continuation page limit (${HISTORY_MAX_CONTINUATION_PAGES}); some history may not be imported.`,
            );
          }
        }
      } else if (!initialContinuationToken) {
        logger.debug(
          "No continuation token on history page; nothing to paginate.",
        );
      } else {
        logger.warn(
          "Missing INNERTUBE_API_KEY or INNERTUBE_CONTEXT; cannot paginate YouTube history.",
        );
      }

      const result = {
        objVideos: [],
        videoCount: processedCount,
        updatedCount: updatedCount,
        newCount: processedCount,
        skippedCount: skippedCount,
        totalSeen,
        pagesFetched,
      };

      logger.info(
        `YouTube sync completed: scanned ${totalSeen} videos across ${pagesFetched + 1} page(s); ${processedCount} new, ${updatedCount} updated, ${skippedCount} unchanged`,
      );
      return result;
    } catch (error) {
      logger.error("YouTube synchronization error:", error);
      throw error;
    }
  }

  /**
   * Synchronize YouTube liked videos
   * @param {Function} [onProgress] - Optional progress callback
   * @returns {Promise<Object>} Synchronization result
   */
  async synchronizeLikedVideos(onProgress = null) {
    try {
      const currentProvider = this.getProvider();
      logger.info("Starting YouTube liked videos sync (single page only)...");

      // Fetch YouTube liked videos page
      const response = await fetch("https://www.youtube.com/playlist?list=LL");

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseText = await response.text();

      // Use parser to extract videos from the page
      const objVideos = parseLikedVideosPage(responseText);

      // Store videos in the current provider
      let processedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const video of objVideos) {
        try {
          const upsertResult = await this.upsertSourceVideo(
            currentProvider,
            video,
          );

          if (upsertResult.status === "created") {
            processedCount++;
          } else if (upsertResult.status === "updated") {
            updatedCount++;
          } else {
            skippedCount++;
          }

          // Report progress every 10 videos
          if (
            processedCount + updatedCount > 0 &&
            (processedCount + updatedCount) % 10 === 0 &&
            onProgress
          ) {
            onProgress({
              strProgress: `processed ${processedCount + updatedCount} liked videos`,
            });
          }
        } catch (error) {
          logger.error(`Error storing video ${video.strIdent}:`, error);
        }
      }

      // Return results
      const result = {
        objVideos: objVideos,
        videoCount: processedCount,
        newCount: processedCount,
        updatedCount: updatedCount,
        skippedCount: skippedCount,
      };

      logger.info(
        `Liked videos sync completed: Found ${objVideos.length} total videos, ${processedCount} new added, ${updatedCount} updated, ${skippedCount} unchanged`,
      );
      return result;
    } catch (error) {
      logger.error("Liked videos synchronization error:", error);
      throw error;
    }
  }

  /**
   * Look up a video in the database
   * @param {string} videoId - Video ID to look up
   * @returns {Promise<Object|null>} Video object or null if not found
   */
  async lookup(videoId) {
    try {
      // Validate video ID
      if (
        !videoId ||
        typeof videoId !== "string" ||
        videoId.length !== VIDEO_ID_LENGTH
      ) {
        const received =
          videoId === null
            ? "null"
            : videoId === undefined
              ? "undefined"
              : `${typeof videoId} (${JSON.stringify(videoId).slice(0, 50)})`;
        throw new Error(
          `Invalid video ID: expected 11-char string, got ${received}`,
        );
      }

      const currentProvider = this.getProvider();

      // Get the specific video from the current provider
      const video = await currentProvider.getVideo(videoId);

      if (video) {
        return {
          strIdent: video.strIdent,
          intTimestamp: video.intTimestamp || Date.now(),
          strTitle: video.strTitle || "",
          intCount: video.intCount || 1,
        };
      }

      return null;
    } catch (error) {
      logger.error("YouTube lookup error:", error);
      throw error;
    }
  }

  /**
   * Ensure a video exists in the database
   * @param {string} videoId - Video ID
   * @param {string} [title] - Video title
   * @param {number} [timestamp] - Timestamp
   * @param {number} [count] - View count
   * @returns {Promise<Object>} Video object
   */
  async ensure(videoId, title = "", timestamp = null, count = null) {
    try {
      // Validate video ID
      if (
        !videoId ||
        typeof videoId !== "string" ||
        videoId.length !== VIDEO_ID_LENGTH
      ) {
        const received =
          videoId === null
            ? "null"
            : videoId === undefined
              ? "undefined"
              : `${typeof videoId} (${JSON.stringify(videoId).slice(0, 50)})`;
        throw new Error(
          `Invalid video ID: expected 11-char string, got ${received}`,
        );
      }

      const currentProvider = this.getProvider();

      // Check if video already exists in the database
      const existingVideo = await currentProvider.getVideo(videoId);

      let videoToReturn;
      if (existingVideo) {
        // Prefer valid titles when updating existing videos
        let titleToUse = existingVideo.strTitle || "";
        if (title && isValidVideoTitle(title)) {
          titleToUse = title;
        } else if (!isValidVideoTitle(titleToUse) && title) {
          // If existing title is invalid but new title exists, use new title
          titleToUse = title;
        }

        // Return existing video data with potentially updated title
        logger.debug("Returning existing video data for:", videoId);
        videoToReturn = {
          strIdent: existingVideo.strIdent,
          intTimestamp: existingVideo.intTimestamp,
          strTitle: titleToUse,
          intCount: existingVideo.intCount || 1,
        };

        // Update the database if title changed
        if (titleToUse !== existingVideo.strTitle) {
          await currentProvider.putVideo(videoToReturn);
        }
      } else {
        // Create new video entry only with valid titles
        const titleToUse = title && isValidVideoTitle(title) ? title : "";

        logger.debug("Creating new video entry for:", videoId);
        const newVideo = {
          strIdent: videoId,
          intTimestamp: timestamp || Date.now(),
          strTitle: titleToUse,
          intCount: count || 1,
        };

        // Store the new video in the current provider
        await currentProvider.putVideo(newVideo);
        videoToReturn = newVideo;
      }

      return videoToReturn;
    } catch (error) {
      logger.error("YouTube ensure error:", error);
      throw error;
    }
  }

  /**
   * Mark a video as watched
   * @param {string} videoId - Video ID
   * @param {string} [title] - Video title
   * @param {number} [timestamp] - Timestamp
   * @param {number} [count] - View count
   * @returns {Promise<Object>} Video object
   */
  async mark(videoId, title = "", timestamp = null, count = null) {
    try {
      // Validate video ID
      if (
        !videoId ||
        typeof videoId !== "string" ||
        videoId.length !== VIDEO_ID_LENGTH
      ) {
        const received =
          videoId === null
            ? "null"
            : videoId === undefined
              ? "undefined"
              : `${typeof videoId} (${JSON.stringify(videoId).slice(0, 50)})`;
        throw new Error(
          `Invalid video ID: expected 11-char string, got ${received}`,
        );
      }

      const currentProvider = this.getProvider();

      // Check if video already exists in the database
      const existingVideo = await currentProvider.getVideo(videoId);
      const currentTime = Date.now();

      let videoToStore;
      if (existingVideo) {
        // Update existing video
        const existingTimestamp = existingVideo.intTimestamp || 0;
        const timeSinceLastView = currentTime - existingTimestamp;

        // Only increment count if enough time has passed since last view
        const shouldIncrementCount =
          timeSinceLastView >= TIMEOUTS.VIEW_COUNT_COOLDOWN;

        // Prefer valid titles over invalid ones
        let titleToUse = existingVideo.strTitle || "";
        if (title && isValidVideoTitle(title)) {
          titleToUse = title;
        } else if (!isValidVideoTitle(titleToUse) && title) {
          // If existing title is invalid but new title exists, use new title even if not ideal
          titleToUse = title;
        }

        videoToStore = {
          strIdent: existingVideo.strIdent,
          intTimestamp: timestamp || currentTime,
          strTitle: titleToUse,
          intCount: shouldIncrementCount
            ? existingVideo.intCount + 1 || 1
            : existingVideo.intCount || 1,
        };
      } else {
        // Create new video entry only if title is valid or no title is provided
        const titleToUse = title && isValidVideoTitle(title) ? title : "";

        videoToStore = {
          strIdent: videoId,
          intTimestamp: timestamp || currentTime,
          strTitle: titleToUse,
          intCount: count || 1,
        };
      }

      // Store the video in the current provider
      await currentProvider.putVideo(videoToStore);

      return videoToStore;
    } catch (error) {
      logger.error("YouTube mark error:", error);
      throw error;
    }
  }
}

// Global instance
export const Youtube = new YoutubeManager();

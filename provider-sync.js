// @ts-check

/**
 * Provider Sync Utilities
 * Handles synchronization logic between database providers
 */

import { logger } from "./logger.js";

/**
 * Storage key for last delta sync timestamp
 */
export const DELTA_SYNC_STORAGE_KEY = "last_delta_sync_timestamp";
export const SUPABASE_SYNC_BATCH_SIZE = 100;

/**
 * Import videos through a provider in bounded batches.
 * @param {Object} provider - Provider with importVideos(videos)
 * @param {Array} videos - Videos to import
 * @param {number} batchSize - Maximum rows per import call
 * @returns {Promise<number>} Number of videos passed to the provider
 */
export async function importVideosInBatches(
  provider,
  videos,
  batchSize = SUPABASE_SYNC_BATCH_SIZE,
) {
  if (!videos || videos.length === 0) {
    return 0;
  }

  let imported = 0;
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    await provider.importVideos(batch);
    imported += batch.length;
  }

  return imported;
}

/**
 * Perform delta sync - only sync videos modified since last sync
 * Much more efficient than full sync for large databases
 * @param {Object} indexedDBProvider - IndexedDB provider instance
 * @param {Object} supabaseProvider - Supabase provider instance
 * @returns {Promise<Object>} Sync result with stats
 */
export async function performDeltaSync(indexedDBProvider, supabaseProvider) {
  if (!supabaseProvider || !supabaseProvider.isConnected) {
    return { success: false, error: "Supabase not available" };
  }

  try {
    // Load last sync timestamp
    const result = await chrome.storage.local.get([DELTA_SYNC_STORAGE_KEY]);
    const lastSync = result[DELTA_SYNC_STORAGE_KEY] || 0;
    const now = Date.now();

    // Get videos modified since last sync from IndexedDB
    const modifiedVideos = await indexedDBProvider.getVideosByDateRange(
      lastSync,
      now,
    );

    if (modifiedVideos.length === 0) {
      logger.debug("Delta sync: no new videos to sync");
      return { success: true, synced: 0 };
    }

    const synced = await importVideosInBatches(
      supabaseProvider,
      modifiedVideos,
    );

    // Update last sync timestamp
    await chrome.storage.local.set({
      [DELTA_SYNC_STORAGE_KEY]: now,
    });

    logger.info(`Delta sync complete: synced ${synced} videos`);
    return { success: true, synced };
  } catch (error) {
    logger.error("Delta sync failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Perform initial full sync from Supabase to IndexedDB
 * Used when setting up Supabase for the first time
 * @param {Object} indexedDBProvider - IndexedDB provider instance
 * @param {Object} supabaseProvider - Supabase provider instance
 * @returns {Promise<Object>} Sync result
 */
export async function performInitialSync(indexedDBProvider, supabaseProvider) {
  if (!supabaseProvider.isConnected) {
    return { success: false, error: "Supabase not connected" };
  }

  try {
    logger.info("Starting initial sync from Supabase...");

    // Get all videos from Supabase
    const supabaseVideos = await supabaseProvider.getAllVideos();

    if (supabaseVideos.length === 0) {
      logger.info("Initial sync: no videos in Supabase");
      return { success: true, imported: 0 };
    }

    // Import to IndexedDB (will merge with existing)
    await importVideosInBatches(indexedDBProvider, supabaseVideos, 500);

    // Update last sync timestamp to now
    await chrome.storage.local.set({
      [DELTA_SYNC_STORAGE_KEY]: Date.now(),
    });

    logger.info(
      `Initial sync complete: imported ${supabaseVideos.length} videos from Supabase`,
    );
    return { success: true, imported: supabaseVideos.length };
  } catch (error) {
    logger.error("Initial sync failed:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sync data between two providers (bidirectional merge)
 * @param {Object} provider1 - First provider instance
 * @param {Object} provider2 - Second provider instance
 * @returns {Promise<boolean>} Success status
 */
export async function syncProviders(provider1, provider2) {
  try {
    // Get all data from both providers
    const data1 = await provider1.getAllVideos();
    const data2 = await provider2.getAllVideos();

    // Merge data (keep the most recent timestamp for each video)
    const mergedData = mergeVideoData(data1, data2);

    // Update both providers with merged data
    await importVideosInBatches(provider1, mergedData, 500);
    await importVideosInBatches(provider2, mergedData);

    return true;
  } catch (error) {
    console.error(
      "Data sync failed:",
      JSON.stringify(
        {
          error: error.message,
          errorName: error.name,
          errorStack: error.stack,
        },
        null,
        2,
      ),
    );
    throw error;
  }
}

/**
 * Merge video data from two sources
 * @param {Array} data1 - First data set
 * @param {Array} data2 - Second data set
 * @returns {Array} Merged data
 */
export function mergeVideoData(data1, data2) {
  const merged = new Map();

  // Add all videos from data1
  data1.forEach((video) => {
    merged.set(video.strIdent, video);
  });

  // Merge with data2, keeping the most recent timestamp
  data2.forEach((video) => {
    const existing = merged.get(video.strIdent);
    if (!existing) {
      merged.set(video.strIdent, video);
    } else {
      // Keep the video with the most recent timestamp
      const mergedVideo = {
        ...existing,
        ...video,
        intTimestamp: Math.max(
          existing.intTimestamp || 0,
          video.intTimestamp || 0,
        ),
        intCount: Math.max(existing.intCount || 1, video.intCount || 1),
        strTitle: video.strTitle || existing.strTitle, // Prefer non-null title
      };
      merged.set(video.strIdent, mergedVideo);
    }
  });

  return Array.from(merged.values());
}

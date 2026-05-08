// @ts-check

import { databaseProviderFactory } from "./database-provider-factory.js";
import { supabaseDatabaseProvider } from "./supabase-database-provider.js";

const SUSPICIOUS_CLUSTER_MIN_SIZE = 25;
const CLUSTER_WINDOW_MS = 60 * 1000;
const HISTORY_REPAIR_TOLERANCE_MS = 5 * 60 * 1000;

function normalizeVideoId(videoId) {
  return typeof videoId === "string" ? videoId.trim() : "";
}

function normalizeTimestamp(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeCount(count) {
  const value = Number(count);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function chooseTitle(videos) {
  const sortedVideos = [...videos].sort(
    (first, second) =>
      normalizeTimestamp(second.intTimestamp) -
      normalizeTimestamp(first.intTimestamp),
  );
  const latestTitle = sortedVideos.find((video) => video.strTitle)?.strTitle;
  if (latestTitle) {
    return String(latestTitle);
  }

  const longestTitle = videos
    .map((video) => String(video.strTitle || ""))
    .sort((first, second) => second.length - first.length)[0];
  return longestTitle || "";
}

function mergeDuplicateGroup(videoId, videos) {
  const timestamps = videos.map((video) =>
    normalizeTimestamp(video.intTimestamp),
  );
  const totalCount = videos.reduce(
    (sum, video) => sum + normalizeCount(video.intCount),
    0,
  );

  return {
    strIdent: videoId,
    intTimestamp: Math.max(...timestamps, 0),
    strTitle: chooseTitle(videos),
    intCount: Math.max(totalCount, videos.length, 1),
  };
}

function groupVideosById(videos) {
  const groups = new Map();

  for (const video of videos) {
    const videoId = normalizeVideoId(video.strIdent);
    if (!videoId) {
      continue;
    }

    const group = groups.get(videoId) || [];
    group.push({ ...video, strIdent: videoId });
    groups.set(videoId, group);
  }

  return groups;
}

function buildDuplicateIdReport(videos) {
  const duplicateGroups = [];

  for (const [videoId, group] of groupVideosById(videos)) {
    if (group.length <= 1) {
      continue;
    }

    duplicateGroups.push({
      videoId,
      rows: group.length,
      mergedCount: mergeDuplicateGroup(videoId, group).intCount,
      timestamps: group
        .map((video) => normalizeTimestamp(video.intTimestamp))
        .filter(Boolean)
        .sort((first, second) => first - second),
    });
  }

  duplicateGroups.sort((first, second) => second.rows - first.rows);
  return duplicateGroups;
}

function buildTimestampClusterReport(videos) {
  const clusters = new Map();

  for (const video of videos) {
    const timestamp = normalizeTimestamp(video.intTimestamp);
    if (!timestamp) {
      continue;
    }

    const clusterKey = Math.floor(timestamp / CLUSTER_WINDOW_MS);
    const cluster = clusters.get(clusterKey) || [];
    cluster.push(video);
    clusters.set(clusterKey, cluster);
  }

  return [...clusters.entries()]
    .filter(([, cluster]) => cluster.length >= SUSPICIOUS_CLUSTER_MIN_SIZE)
    .map(([clusterKey, cluster]) => ({
      timestampStart: clusterKey * CLUSTER_WINDOW_MS,
      timestampEnd: clusterKey * CLUSTER_WINDOW_MS + CLUSTER_WINDOW_MS - 1,
      rows: cluster.length,
      sampleVideoIds: cluster.slice(0, 10).map((video) => video.strIdent),
    }))
    .sort((first, second) => second.rows - first.rows);
}

function consolidateVideos(videos) {
  return [...groupVideosById(videos).entries()]
    .map(([videoId, group]) =>
      group.length === 1 ? group[0] : mergeDuplicateGroup(videoId, group),
    )
    .sort((first, second) => second.intTimestamp - first.intTimestamp);
}

function mergeRemoteIntoLocal(localVideos, remoteVideos) {
  const mergedById = new Map(
    localVideos.map((video) => [normalizeVideoId(video.strIdent), video]),
  );
  const consolidatedRemoteVideos = consolidateVideos(remoteVideos);

  for (const remoteVideo of consolidatedRemoteVideos) {
    const videoId = normalizeVideoId(remoteVideo.strIdent);
    const localVideo = mergedById.get(videoId);

    if (!localVideo) {
      mergedById.set(videoId, remoteVideo);
      continue;
    }

    mergedById.set(videoId, {
      strIdent: videoId,
      intTimestamp:
        normalizeTimestamp(localVideo.intTimestamp) ||
        normalizeTimestamp(remoteVideo.intTimestamp),
      strTitle: chooseTitle([localVideo, remoteVideo]),
      intCount: Math.max(
        normalizeCount(localVideo.intCount),
        normalizeCount(remoteVideo.intCount),
      ),
    });
  }

  return [...mergedById.values()].sort(
    (first, second) =>
      normalizeTimestamp(second.intTimestamp) -
      normalizeTimestamp(first.intTimestamp),
  );
}

function isVideoUrlForId(url, videoId) {
  if (!url) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "www.youtube.com") {
      if (parsedUrl.pathname === "/watch") {
        return parsedUrl.searchParams.get("v") === videoId;
      }

      return parsedUrl.pathname === `/shorts/${videoId}`;
    }

    if (parsedUrl.hostname === "m.youtube.com") {
      return (
        parsedUrl.pathname === "/watch" &&
        parsedUrl.searchParams.get("v") === videoId
      );
    }
  } catch (_error) {
    return false;
  }

  return false;
}

function getBrowserHistoryLastVisitTime(videoId) {
  return new Promise((resolve) => {
    chrome.history.search(
      {
        text: videoId,
        startTime: 0,
        maxResults: 100,
      },
      (results) => {
        if (chrome.runtime.lastError || !Array.isArray(results)) {
          resolve(0);
          return;
        }

        const matchingVisits = results
          .filter((result) => isVideoUrlForId(result.url, videoId))
          .map((result) => normalizeTimestamp(result.lastVisitTime))
          .filter(Boolean);

        resolve(matchingVisits.length ? Math.max(...matchingVisits) : 0);
      },
    );
  });
}

function findSuspiciousClusterKeys(videos) {
  return new Set(
    buildTimestampClusterReport(videos).map((cluster) =>
      Math.floor(cluster.timestampStart / CLUSTER_WINDOW_MS),
    ),
  );
}

async function repairSuspiciousTimestamps(videos) {
  const suspiciousClusterKeys = findSuspiciousClusterKeys(videos);
  if (suspiciousClusterKeys.size === 0) {
    return { videos, repairedCount: 0 };
  }

  const repairedVideos = [];
  let repairedCount = 0;

  for (const video of videos) {
    const timestamp = normalizeTimestamp(video.intTimestamp);
    const clusterKey = Math.floor(timestamp / CLUSTER_WINDOW_MS);

    if (!suspiciousClusterKeys.has(clusterKey)) {
      repairedVideos.push(video);
      continue;
    }

    const historyTimestamp = await getBrowserHistoryLastVisitTime(
      video.strIdent,
    );
    const hasDifferentHistoryTimestamp =
      historyTimestamp &&
      Math.abs(historyTimestamp - timestamp) > HISTORY_REPAIR_TOLERANCE_MS;

    if (!hasDifferentHistoryTimestamp) {
      repairedVideos.push(video);
      continue;
    }

    repairedVideos.push({
      ...video,
      intTimestamp: historyTimestamp,
      intCount: Math.max(normalizeCount(video.intCount), 1),
    });
    repairedCount++;
  }

  return { videos: repairedVideos, repairedCount };
}

async function replaceProviderVideos(provider, videos) {
  await provider.clearAllVideos();
  await provider.importVideos(videos);
}

async function auditProvider(name, provider) {
  const videos = await provider.getAllVideos();
  const duplicateIdGroups = buildDuplicateIdReport(videos);
  const timestampClusters = buildTimestampClusterReport(videos);

  return {
    name,
    rowCount: videos.length,
    uniqueVideoIds: groupVideosById(videos).size,
    duplicateIdGroups,
    duplicateRowCount: duplicateIdGroups.reduce(
      (sum, group) => sum + group.rows - 1,
      0,
    ),
    timestampClusters,
  };
}

/**
 * Audit local and configured remote databases for duplicate IDs and suspicious
 * timestamp clusters.
 * @returns {Promise<Object>} Integrity report
 */
export async function auditDatabaseIntegrity() {
  const reports = [];
  const localProvider = databaseProviderFactory.getCurrentProvider();

  reports.push(await auditProvider("IndexedDB", localProvider));

  if (databaseProviderFactory.isSupabaseEnabled()) {
    reports.push(await auditProvider("Supabase", supabaseDatabaseProvider));
  }

  return { reports };
}

/**
 * Export raw rows from every configured provider before a repair.
 * @returns {Promise<Object>} Backup payload
 */
export async function exportIntegrityBackup() {
  const localProvider = databaseProviderFactory.getCurrentProvider();
  const backup = {
    timestamp: Date.now(),
    providers: {
      indexedDB: await localProvider.getAllVideos(),
    },
  };

  if (databaseProviderFactory.isSupabaseEnabled()) {
    backup.providers.supabase = await supabaseDatabaseProvider.getAllVideos();
  }

  return backup;
}

/**
 * Consolidate duplicate IDs and repair suspicious timestamp clusters when the
 * browser history has a real lastVisitTime for the same video ID.
 * @returns {Promise<Object>} Repair result
 */
export async function repairDatabaseIntegrity() {
  const provider = databaseProviderFactory.getCurrentProvider();
  const originalVideos = await provider.getAllVideos();
  const before = {
    duplicateIdGroups: buildDuplicateIdReport(originalVideos),
    timestampClusters: buildTimestampClusterReport(originalVideos),
  };

  const consolidatedVideos = consolidateVideos(originalVideos);
  const timestampRepair = await repairSuspiciousTimestamps(consolidatedVideos);
  let repairedVideos = timestampRepair.videos;

  const needsLocalReplace =
    before.duplicateIdGroups.length > 0 || timestampRepair.repairedCount > 0;

  if (needsLocalReplace) {
    await replaceProviderVideos(provider, repairedVideos);
  }

  let supabaseRepair = null;
  if (databaseProviderFactory.isSupabaseEnabled()) {
    const supabaseVideos = await supabaseDatabaseProvider.getAllVideos();
    const supabaseDuplicateGroups = buildDuplicateIdReport(supabaseVideos);

    if (supabaseDuplicateGroups.length > 0 || needsLocalReplace) {
      const mergedVideos = mergeRemoteIntoLocal(repairedVideos, supabaseVideos);
      await replaceProviderVideos(provider, mergedVideos);
      await replaceProviderVideos(supabaseDatabaseProvider, mergedVideos);
      repairedVideos = mergedVideos;
      supabaseRepair = {
        duplicateGroups: supabaseDuplicateGroups.length,
        rowCountAfter: mergedVideos.length,
      };
    }
  }

  const after = await auditDatabaseIntegrity();

  return {
    before,
    after,
    local: {
      duplicateGroupsConsolidated: before.duplicateIdGroups.length,
      duplicateRowsRemoved: before.duplicateIdGroups.reduce(
        (sum, group) => sum + group.rows - 1,
        0,
      ),
      timestampsRepairedFromChromeHistory: timestampRepair.repairedCount,
      rowCountBefore: originalVideos.length,
      rowCountAfter: repairedVideos.length,
    },
    supabase: supabaseRepair,
  };
}

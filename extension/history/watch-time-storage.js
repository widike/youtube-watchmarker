import { watchTimePage, mergeWatchTimes } from "./watch-time-replication.js";
import "../shared/video-identity.js";

const MINUTE = 60_000;

export function validateWatchTime(request, sender, now = Date.now()) {
  // The manifest injects the tracker only into top-level documents. During
  // pagehide Chrome can assign the departing document a nonzero frame ID
  // while retaining its document ID and tab ID.
  const departingDocument =
    Number.isInteger(sender?.frameId) &&
    sender.frameId > 0 &&
    typeof sender.documentId === "string" &&
    sender.documentId.length > 0 &&
    ["cached", "pending_deletion"].includes(sender.documentLifecycle);
  if (
    !globalThis.YouTubeWatchmarkerVideo.isVideoId(request.videoId) ||
    !/^[a-f0-9-]{36}$/i.test(request.sessionId || "") ||
    !Number.isInteger(sender?.tab?.id) ||
    sender.tab.id < 0 ||
    (sender.frameId !== 0 && !departingDocument) ||
    !Number.isFinite(request.watchedMilliseconds) ||
    request.watchedMilliseconds < MINUTE ||
    !Array.isArray(request.buckets) ||
    !request.buckets.length ||
    request.buckets.length > 20
  )
    throw new Error("Invalid playback time report");
  for (const bucket of request.buckets) {
    if (
      bucket.mediaRanges !== undefined &&
      (!Number.isFinite(bucket.durationSeconds) ||
        bucket.durationSeconds <= 0 ||
        !Array.isArray(bucket.mediaRanges) ||
        bucket.mediaRanges.length > 500 ||
        bucket.mediaRanges.some(
          (range) =>
            !Array.isArray(range) ||
            range.length !== 2 ||
            !range.every(Number.isFinite) ||
            range[0] < 0 ||
            range[1] <= range[0] ||
            range[1] > bucket.durationSeconds,
        ))
    )
      throw new Error("Invalid playback coverage");
    if (
      !Number.isSafeInteger(bucket.minute) ||
      bucket.minute <= 0 ||
      bucket.minute % MINUTE ||
      bucket.minute > now ||
      !Number.isSafeInteger(bucket.milliseconds) ||
      bucket.milliseconds <= 0 ||
      bucket.milliseconds > MINUTE ||
      !Number.isSafeInteger(bucket.from) ||
      !Number.isSafeInteger(bucket.to) ||
      bucket.from < bucket.minute ||
      bucket.to > bucket.minute + MINUTE ||
      bucket.to > now + 2000 ||
      bucket.to - bucket.from < bucket.milliseconds
    )
      throw new Error("Invalid playback time interval");
  }
}

// Cumulative minute snapshots have stable identities. Lost replies, duplicate
// messages, out-of-order delivery and service-worker restarts cannot add time.
export async function saveWatchTime(db, request, sender, now = Date.now()) {
  validateWatchTime(request, sender, now);
  await mergeWatchTimes(
    db,
    request.buckets.map((bucket) => ({
      ...bucket,
      snapshotId: `${sender.tab.id}:${sender.documentId || ""}:${request.sessionId}:${bucket.minute}`,
      eventId: `playback:${sender.tab.id}:${sender.documentId || ""}:${request.sessionId}`,
      strIdent: request.videoId,
      strTitle: String(request.title || ""),
    })),
    { pending: true },
  );
  return true;
}

export async function readWatchTime(db) {
  return watchTimePage(db, "", Infinity);
}

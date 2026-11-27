import {
  watchTimeForVideos,
  watchTimePage,
  putWatchTimes,
} from "./watch-time-replication.js";
import { EVENT_STORE } from "./history-event-storage.js";
import { META_STORE, readRequest, transactionDone } from "./history-storage.js";
import { DATABASE } from "../shared/constants.js";
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
    !Number.isSafeInteger(request.eventWatchedAt) ||
    request.eventWatchedAt <= 0 ||
    request.eventWatchedAt > now + 2000 ||
    !Array.isArray(request.buckets) ||
    !request.buckets.length ||
    request.buckets.length > 20
  )
    throw new Error("Invalid playback time report");
  const minutes = new Set();
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
      minutes.has(bucket.minute) ||
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
    minutes.add(bucket.minute);
  }
}

// Cumulative minute snapshots have stable identities. Lost replies, duplicate
// messages, out-of-order delivery and service-worker restarts cannot add time.
export async function saveWatchTime(db, request, sender, now = Date.now()) {
  validateWatchTime(request, sender, now);
  const playbackId = `${sender.tab.id}:${sender.documentId || ""}:${request.sessionId}`;
  const eventId = `playback:${playbackId}`;
  const tx = db.transaction(
    [META_STORE, EVENT_STORE, DATABASE.STORE_NAME],
    "readwrite",
    { durability: "strict" },
  );
  let failure;
  const done = transactionDone(tx, () => failure);
  try {
    const [event, first, video] = await Promise.all([
      readRequest(tx.objectStore(EVENT_STORE).get([request.videoId, eventId])),
      readRequest(
        tx
          .objectStore(META_STORE)
          .index("watchTimeEvent")
          .get([request.videoId, eventId]),
      ),
      readRequest(tx.objectStore(DATABASE.STORE_NAME).get(request.videoId)),
    ]);
    const marker = video?.intDeletedAt || 0;
    const observedDeletion =
      event?.observedDeletion ?? first?.observedDeletion ?? marker;
    const eventWatchedAt =
      event?.watchedAt || first?.eventWatchedAt || request.eventWatchedAt;
    if (observedDeletion === marker && eventWatchedAt > marker) {
      putWatchTimes(
        tx,
        request.buckets.map((bucket) => ({
          ...bucket,
          snapshotId: `${playbackId}:${bucket.minute}`,
          eventId,
          eventWatchedAt,
          observedDeletion,
          strIdent: request.videoId,
          strTitle: String(request.title || ""),
        })),
        {
          pending: true,
          fail: (error) => {
            failure = error;
          },
        },
      );
    }
  } catch (error) {
    failure = error;
    try {
      tx.abort();
    } catch {
      /* A failed request may have aborted it. */
    }
  }
  await done;
  return true;
}

export async function readWatchTime(db, videoIds) {
  return videoIds
    ? watchTimeForVideos(db, videoIds)
    : watchTimePage(db, "", Infinity);
}

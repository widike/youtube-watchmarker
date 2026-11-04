import {
  saveWatchTime,
  readWatchTime,
} from "../../extension/history/watch-time-storage.js";
import { enrichHistoryVideos } from "../../extension/history/history-video-statistics.js";
import "../../extension/shared/video-identity.js";
import "../../extension/youtube/core.js";
import "../../extension/youtube/watch-time.js";
import "../../extension/youtube/playback.js";

// Play a real local media resource at 2× speed through the actual content
// tracker and IndexedDB writer. No YouTube account or network is involved.
export async function verifyRealPlayback(assert) {
  const name = `watchmarker-real-playback-${crypto.randomUUID()}`;
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("historyMetadata");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const bytes = new Uint8Array(44 + 8000 * 3 * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) =>
    [...value].forEach((char, index) =>
      view.setUint8(offset + index, char.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const container = document.createElement("div");
  container.id = "movie_player";
  const player = document.createElement("video");
  player.muted = true;
  player.playbackRate = 2;
  player.src = url;
  player.style.cssText =
    "width:16px;height:16px;position:fixed;bottom:0;right:0";
  container.append(player);
  document.body.append(container);
  const preview = document.createElement("video");
  const audio = document.createElement("audio");
  document.body.append(preview, audio);
  const { core, PlaybackTracker } = globalThis.YouTubeWatchmarkerContent;
  const currentVideo = core.getCurrentVideoId;
  core.getCurrentVideoId = () => "abcdefghijk";
  const writes = [];
  const reports = [];
  const tracker = new PlaybackTracker(
    {
      send: async (message) => {
        reports.push(message);
        if (message.action === "youtube-watch-time") {
          const write = saveWatchTime(db, message, {
            tab: { id: 1 },
            frameId: 0,
            documentId: "real-media",
          });
          writes.push(write);
          await write;
        }
        return { success: true };
      },
    },
    { updateWatchState() {} },
  );
  tracker.initialize();
  let timer;
  let unrelatedEvents;
  try {
    // Real document-capture listeners must ignore other media while the main
    // player advances. Previously these events repeatedly cleared its sample.
    unrelatedEvents = setInterval(() => {
      preview.dispatchEvent(new Event("timeupdate"));
      audio.dispatchEvent(new Event("pause"));
    }, 50);
    const ended = new Promise((resolve, reject) => {
      player.addEventListener("ended", resolve, { once: true });
      player.addEventListener(
        "error",
        () => reject(new Error("Media fixture failed")),
        { once: true },
      );
      timer = setTimeout(() => reject(new Error("Media did not end")), 8000);
    });
    if (player.readyState === 0)
      await new Promise((resolve) =>
        player.addEventListener("loadedmetadata", resolve, { once: true }),
      );
    player.playbackRate = 2;
    await player.play();
    await ended;
    await Promise.all(writes);
    const elapsed = tracker.session.watchedMilliseconds;
    assert(
      elapsed > 700 && elapsed < 2100,
      `Actual 2× playback measured ${elapsed} ms for a 3000 ms resource`,
    );
    assert(reports.length === 0, "A short real playback sent a history report");
    assert(
      (await readWatchTime(db)).length === 0,
      "A short playback persisted duration",
    );
  } finally {
    clearTimeout(timer);
    clearInterval(unrelatedEvents);
    player.pause();
    tracker.watchTime.reset();
    core.getCurrentVideoId = currentVideo;
    container.remove();
    preview.remove();
    audio.remove();
    URL.revokeObjectURL(url);
    db.close();
    indexedDB.deleteDatabase(name);
  }
}

export async function verifyDurationPersistence(assert) {
  const name = `watchmarker-time-${crypto.randomUUID()}`;
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("historyMetadata");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  let db = await open();
  const minute = Math.floor((Date.now() - 120000) / 60000) * 60000;
  const packet = (milliseconds) => ({
    videoId: "abcdefghijk",
    sessionId: "00000000-0000-4000-8000-000000000001",
    title: "Space",
    watchedMilliseconds: 60_000,
    buckets: [
      {
        minute,
        from: minute,
        to: minute + milliseconds,
        milliseconds,
        durationSeconds: 60,
        mediaRanges: [[0, milliseconds / 500]],
      },
    ],
  });
  const sender = { tab: { id: 1 }, frameId: 0, documentId: "fixture" };
  await Promise.all([
    saveWatchTime(db, packet(1000), sender),
    saveWatchTime(db, packet(2000), sender),
    saveWatchTime(db, packet(1000), sender),
  ]);
  assert(
    (await readWatchTime(db))[0].milliseconds === 2000,
    "Duplicate duration delivery added time",
  );
  // Chrome can give the departing top-level document a nonzero frame ID
  // before delivering a final flush during cross-site navigation.
  await saveWatchTime(db, packet(2500), {
    ...sender,
    frameId: 5,
    documentLifecycle: "cached",
  });
  db.close();
  db = await open();
  assert(
    (await readWatchTime(db))[0].milliseconds === 2500,
    "The cached document's final flush did not update the existing snapshot",
  );
  await saveWatchTime(db, packet(3000), {
    ...sender,
    frameId: 5,
    documentLifecycle: "pending_deletion",
  });
  assert(
    (await readWatchTime(db)).length === 1 &&
      (await readWatchTime(db))[0].milliseconds === 3000,
    "The departing document's final flush split or lost the playback snapshot",
  );
  const time = await readWatchTime(db);
  const [entry] = enrichHistoryVideos(
    [{ strIdent: "abcdefghijk", entryId: `abcdefghijk:${time[0].eventId}` }],
    time,
    [],
  );
  assert(
    entry.durationSeconds === 60 &&
      entry.watchedPercent === 10 &&
      entry.watchedMilliseconds === 3000,
    "Persisted coverage did not join the exact playback after restart",
  );
  db.close();
  indexedDB.deleteDatabase(name);
  await verifyRealPlayback(assert);
}

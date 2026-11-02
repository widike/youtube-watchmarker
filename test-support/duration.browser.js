import { DurationStorage } from "../duration-storage.js";
import { DurationBackfill } from "../duration-backfill.js";
import { DURATION_TTL, fetchDurations } from "../duration-api.js";
import { readWatchTime, saveWatchTime } from "../watch-time-storage.js";
import { summarizeHistory } from "../history-statistics.js";

export async function verifyDurationBackfill(assert) {
  const name = `watchmarker-duration-${crypto.randomUUID()}`;
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("historyMetadata");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  let db = await open();
  let now = Math.floor(Date.now() / 60_000) * 60_000;
  const values = {};
  const local = {
    get: async (key) => ({ [key]: values[key] }),
    set: async (value) => Object.assign(values, value),
  };
  const storage = new DurationStorage(() => db, local);
  const apiKey = `AIza${"x".repeat(35)}`;
  const requests = [];
  const videoId = "abcdefghijk";
  const removedId = "removed____";
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const videos = [
    {
      strIdent: videoId,
      strTitle: "Science",
      intTimestamp: now - 1000,
      intCount: 2,
      intUnknownCount: 0,
      watchEvents: [
        {
          eventId: "saved:old",
          watchedAt: now - 86400000,
          source: "saved",
          precision: "exact",
          observedDeletion: 0,
        },
        {
          eventId: `playback:1:doc:${sessionId}`,
          watchedAt: now - 1000,
          source: "playback",
          precision: "exact",
          observedDeletion: 0,
        },
      ],
    },
  ];
  videos.push({
    strIdent: removedId,
    strTitle: "Removed video",
    intTimestamp: now - 2000,
    intCount: 1,
  });
  const dependencies = {
    storage,
    clock: () => now,
    getVideos: async () => videos,
    schedule: async () => {},
    clear: async () => {},
    fetchBatch: (ids, key, options) =>
      fetchDurations(ids, key, {
        ...options,
        fetcher: async (url) => {
          requests.push(new URL(url).searchParams.get("id"));
          return new Response(
            JSON.stringify({
              items: [{ id: videoId, contentDetails: { duration: "PT10M" } }],
            }),
            { status: 200 },
          );
        },
      }),
  };
  try {
    let job = new DurationBackfill(dependencies);
    await job.control({ command: "start", apiKey });
    assert(
      !JSON.stringify(values).includes(apiKey),
      "API key was stored in plaintext",
    );
    now += 30_000;
    await job.tick();
    await saveWatchTime(
      db,
      {
        videoId,
        sessionId,
        title: "Science",
        watchedMilliseconds: 60_000,
        buckets: [
          {
            minute: Math.floor((now - 1000) / 60_000) * 60_000,
            from: now - 1000,
            to: now,
            milliseconds: 1000,
          },
        ],
      },
      { tab: { id: 1 }, frameId: 0, documentId: "doc" },
      now,
    );
    db.close();
    db = await open();
    job = new DurationBackfill(dependencies);
    now += 30_000;
    await job.tick();
    assert(requests.length === 1, "Restart fetched a cached duration again");
    const measured = await readWatchTime(db);
    assert(
      measured[0].eventId === videos[0].watchEvents[1].eventId,
      "Playback identity was not recovered from IndexedDB",
    );
    const stats = summarizeHistory(videos, {
      now,
      period: "all",
      time: measured,
      durations: await storage.readCache(now),
    });
    assert(
      // Ten historical minutes, one second before the next video's start for
      // the unavailable video, and one measured second for that next video.
      Math.abs(stats.time.selected - (600 + 1 + 1) / 3600) < 1e-10,
      "Timestamp estimates and matching measured playback were not reconciled",
    );
    now += DURATION_TTL + 60_000;
    db.close();
    db = await open();
    job = new DurationBackfill(dependencies);
    await job.initialize();
    await job.tick();
    assert(
      requests.length === 2 && !requests[1].includes(removedId),
      "Removed video was requested again after expiry and database reopening",
    );
    assert(
      (await job.status()).unavailable === 1 && videos.length === 2,
      "Unavailable video lost its status or history",
    );
    await storage.writeCache([
      { strIdent: "expired____", seconds: 100, expiresAt: now - 1 },
    ]);
    assert(
      (await storage.readCache(now)).length === 2,
      "Expired metadata was not purged",
    );
    await job.control({ command: "forget" });
    assert(
      (await storage.readCache(now)).length === 0,
      "Forget left duration metadata behind",
    );
    assert(
      (await readWatchTime(db)).length === 1,
      "Removing duration cache removed measured playback",
    );
  } finally {
    db.close();
    indexedDB.deleteDatabase(name);
  }
}

export async function verifyDurationControls({ $, assert, waitFor }) {
  location.hash = "sync";
  await waitFor(() => !$("#panel-sync").hidden);
  const form = $("[data-duration-form]");
  const input = form.querySelector("input");
  await waitFor(() => $("[data-duration-status]").textContent === "");
  input.value = `AIza${"x".repeat(35)}`;
  form.requestSubmit();
  await waitFor(() =>
    $("[data-duration-status]").textContent.includes("Queued"),
  );
  assert(input.value === "", "API key remained in the form after saving");
  assert(
    !form.querySelector('[data-duration-command="pause"]').disabled,
    "Pause is not available",
  );
  form.querySelector('[data-duration-command="pause"]').click();
  await waitFor(() =>
    $("[data-duration-status]").textContent.includes("Paused"),
  );
  form.querySelector('[data-duration-command="forget"]').click();
  await waitFor(() => $("[data-duration-status]").textContent === "");
  assert(
    form.querySelector('[data-duration-command="forget"]').disabled,
    "Removed key still appears configured",
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    "Duration controls overflow horizontally",
  );
  location.hash = "statistics";
  await waitFor(
    () =>
      !$("#panel-statistics").hidden &&
      $("#panel-statistics").getAttribute("aria-busy") === "false",
  );
  const fixture = window.statisticsFixture;
  const before = fixture.calls.filter(
    ({ action }) => action === "history-statistics",
  ).length;
  for (const listener of fixture.storageListeners)
    listener(
      {
        youtube_duration_state: {
          oldValue: { cacheRevision: "before" },
          newValue: { cacheRevision: "after" },
        },
      },
      "local",
    );
  await waitFor(
    () =>
      fixture.calls.filter(({ action }) => action === "history-statistics")
        .length > before &&
      $("#panel-statistics").getAttribute("aria-busy") === "false",
  );
}

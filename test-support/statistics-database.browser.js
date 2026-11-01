import { DATABASE } from "../constants.js";
import {
  upgradeHistoryStorage,
  saveVideos,
  pendingVideos,
} from "../history-storage.js";
import { IndexedDBProvider } from "../indexeddb-provider.js";
import { summarizeHistory } from "../history-statistics.js";
import { calendar } from "../ui/statistics-heatmaps.js";
import { mergeVideo } from "../history-records.js";

export async function verifyCalendarDatabase(assert) {
  const name = `watchmarker-calendar-${crypto.randomUUID()}`;
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(DATABASE.STORE_NAME, {
          keyPath: "strIdent",
        });
        upgradeHistoryStorage(request.result, request.transaction);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  let db = await open();
  try {
    const now = new Date(2026, 10, 1, 12).getTime();
    const past = new Date(2025, 5, 10, 12).getTime();
    await saveVideos(db, [
      {
        strIdent: "abcdefghijk",
        strTitle: "Rewatched",
        intTimestamp: now,
        intImportedCount: 0,
        watchEvents: [past, past, now].map((watchedAt, index) => ({
          eventId: `calendar:${index}`,
          watchedAt,
          source: "playback",
          precision: "exact",
          observedDeletion: 0,
        })),
      },
      {
        strIdent: "lmnopqrstuv",
        strTitle: "Imported",
        intTimestamp: past,
        intCount: 8,
      },
    ]);
    db.close();
    db = await open();
    const provider = new IndexedDBProvider({
      database: db,
      isInitialized: true,
    });
    const videos = await provider.getAllVideos({ includeDeleted: true });
    const stats = summarizeHistory(videos, { period: "month", now });
    assert(stats.selected === 1, "Rolling totals include old watches");
    assert(
      stats.unknown === 7,
      "Undated imported views were assigned invented dates",
    );
    assert(
      videos.find(({ strIdent }) => strIdent === "abcdefghijk").watchEvents
        .length === 3,
      "Database reader lost past rewatch events",
    );
    assert(
      calendar(stats, 2025).includes("3 records"),
      "Annual calendar did not read stored event dates and imported timestamps",
    );
    assert(
      calendar(stats, 2026).includes("1 records"),
      "Annual calendar assigned a rewatch to the wrong year",
    );

    // Real IndexedDB reads must reconcile source overlap without rewriting the
    // immutable evidence, including after an extension/database restart.
    const id = "overlap12345";
    const imported = (intTimestamp) => ({
      strIdent: id,
      strTitle: "Source overlap",
      intTimestamp,
      intCount: 1,
    });
    const midnight = new Date(2026, 10, 1).getTime();
    await saveVideos(db, [
      mergeVideo(imported(midnight), imported(now - 1000)),
    ]);
    db.close();
    db = await open();
    const reopened = new IndexedDBProvider({
      database: db,
      isInitialized: true,
    });
    let evidence = await reopened.getAllVideos({ includeDeleted: true });
    assert(
      evidence.find((video) => video.strIdent === id).watchEvents.length === 2,
      "Source reconciliation destroyed raw import evidence",
    );
    assert(
      summarizeHistory(evidence, { now }).selected === 2,
      "Overlapping imports counted as extra watches after database reopen",
    );
    await saveVideos(db, [
      {
        strIdent: id,
        strTitle: "Source overlap",
        intTimestamp: now,
        intImportedCount: 0,
        watchEvents: [
          {
            eventId: "tracked",
            watchedAt: now,
            source: "playback",
            precision: "exact",
            observedDeletion: 0,
          },
        ],
      },
    ]);
    evidence = await reopened.getAllVideos({ includeDeleted: true });
    assert(
      evidence.find((video) => video.strIdent === id).watchEvents.length === 3,
      "Tracked playback overwrote imported evidence",
    );
    assert(
      summarizeHistory(evidence, { now }).selected === 2,
      "Tracked playback was added to its overlapping imports",
    );

    // A source lookup can race a playback transaction. The final provider
    // write must check the current database, not just that earlier snapshot.
    const racedId = "raced1234567";
    const staleImport = {
      strIdent: racedId,
      strTitle: "Race",
      intTimestamp: now,
      intCount: 1,
    };
    await saveVideos(db, [
      {
        ...staleImport,
        intImportedCount: 0,
        watchEvents: [
          {
            eventId: "race-play",
            watchedAt: now,
            source: "playback",
            precision: "exact",
            observedDeletion: 0,
          },
        ],
      },
    ]);
    const before = (await pendingVideos(db)).find(
      (row) => row.strIdent === racedId,
    ).revision;
    await reopened.putVideo(staleImport);
    const raced = await reopened.getVideo(racedId);
    assert(
      raced.watchEvents.length === 1 && raced.intCount === 1,
      "A stale import duplicated a timestamp already recorded by playback",
    );
    assert(
      (await pendingVideos(db)).find((row) => row.strIdent === racedId)
        .revision === before,
      "A duplicate import unnecessarily wrote a new sync obligation",
    );
    await reopened.putVideo({
      ...staleImport,
      intTimestamp: 0,
      strTitle: "A liked title",
    });
    assert(
      JSON.stringify(await reopened.getVideo(racedId)) ===
        JSON.stringify(raced),
      "An undated like raced a watch and changed an already-known video",
    );
    assert(
      (await pendingVideos(db)).find((row) => row.strIdent === racedId)
        .revision === before,
      "An already-known like unnecessarily wrote a new sync obligation",
    );
  } finally {
    db.close();
    indexedDB.deleteDatabase(name);
  }
}

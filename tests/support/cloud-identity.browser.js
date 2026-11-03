import { resolveCloudIdentity } from "../../extension/providers/cloud-identity.js";
import { HistorySync } from "../../extension/providers/provider-sync.js";
import {
  readMetadata,
  writeMetadata,
  saveVideos,
  localPage,
} from "../../extension/history/history-storage.js";
import { DurationStorage } from "../../extension/duration/duration-storage.js";
import { readWatchTime } from "../../extension/history/watch-time-storage.js";
import { historyEntries } from "../../extension/history/history-events.js";
import { enrichHistoryVideos } from "../../extension/history/history-video-statistics.js";

export async function testCloudIdentity({ test, database, remote, assert }) {
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  const configuration = { projectId: "fixture" };
  const session = {
    userId: second,
    historyOwnerId: second,
    refreshToken: "old-token",
  };
  const rpc = (owner) => ({ makeRequest: async () => Response.json(owner) });
  await test("a repaired Mac restores the shared latest watches, lengths and playback without losing local records or rotated tokens", async () => {
    const db = await database();
    const cloud = remote();
    const now = Date.now();
    const minute = Math.floor((now - 120000) / 60000) * 60000;
    const old = {
      strIdent: "abcdefghijk",
      strTitle: "Dory",
      intTimestamp: minute - 86400000,
      intCount: 1,
    };
    await saveVideos(db, [old]);
    await writeMetadata(db, "cloudIdentity", `fixture:${second}`);
    for (const key of [
      "downloadAfter",
      "watchTimeDownloadAfter",
      "durationDownloadAfter",
    ])
      await writeMetadata(db, key, "zzzzzzzzzzz");
    for (const key of ["repair", "watchTimeRepair", "durationRepair"])
      await writeMetadata(db, key, { completedAt: now, after: "" });
    let stored;
    const storage = {
      getSession: async () => ({ ...session, refreshToken: "rotated-token" }),
      storeSession: async (value) => {
        stored = value;
      },
    };
    await resolveCloudIdentity(db, configuration, session, rpc(first), storage);
    assert(
      stored.refreshToken === "rotated-token" &&
        stored.historyOwnerId === first,
      "Recovery overwrote refreshed credentials",
    );
    assert(
      (await readMetadata(db, "cloudIdentity")) === `fixture:${first}`,
      "History binding was not updated",
    );
    assert(
      (await readMetadata(db, "durationDownloadAfter")) === undefined,
      "Old namespace cursor survived recovery",
    );
    await cloud.importVideos([
      {
        ...old,
        watchEvents: [
          {
            eventId: `saved:${old.strIdent}:${old.intTimestamp}`,
            watchedAt: old.intTimestamp,
            source: "saved",
            precision: "day",
            observedDeletion: 0,
          },
        ],
      },
      {
        strIdent: "zzzzzzzzzzz",
        strTitle: "Latest bridge video",
        intTimestamp: minute,
        intImportedCount: 0,
        watchEvents: [
          {
            eventId: "playback:latest",
            watchedAt: minute,
            source: "playback",
            precision: "exact",
            observedDeletion: 0,
          },
        ],
      },
    ]);
    await cloud.importDurations([
      {
        strIdent: "zzzzzzzzzzz",
        seconds: 120,
        fetchedAt: now,
        expiresAt: now + 86400000,
      },
    ]);
    await cloud.importWatchTime([
      {
        snapshotId: "latest:minute",
        eventId: "playback:latest",
        strIdent: "zzzzzzzzzzz",
        strTitle: "Latest bridge video",
        minute,
        from: minute,
        to: minute + 2000,
        milliseconds: 2000,
        observedDeletion: 0,
      },
    ]);
    assert(
      (await new HistorySync(db, cloud).sync()).success,
      "Recovery sync failed on imported precision differences",
    );
    const durations = await new DurationStorage(() => db, {
      get: async () => ({}),
      set: async () => {},
    }).readCache(now);
    const rows = enrichHistoryVideos(
      historyEntries(await localPage(db)),
      await readWatchTime(db),
      durations,
      now,
    );
    const latest = rows.find((row) => row.strIdent === "zzzzzzzzzzz");
    assert(
      latest?.durationSeconds === 120 && latest.watchedMilliseconds === 2000,
      "Restored history is missing watch time or length",
    );
    assert(
      rows.some((row) => row.strIdent === old.strIdent),
      "Recovery lost existing local history",
    );
  });
  await test("server membership cannot switch another owner's or another project's local history", async () => {
    const db = await database();
    const storage = {
      storeSession: async () => {
        throw new Error("Credentials must remain untouched");
      },
    };
    for (const bound of [`fixture:${first}`, `other:${second}`]) {
      await writeMetadata(db, "cloudIdentity", bound);
      let rejected = false;
      try {
        await resolveCloudIdentity(
          db,
          configuration,
          session,
          rpc(second),
          storage,
        );
      } catch {
        rejected = true;
      }
      assert(
        rejected && (await readMetadata(db, "cloudIdentity")) === bound,
        "Unrelated identity changed",
      );
    }
    let rejected = false;
    try {
      await resolveCloudIdentity(
        db,
        configuration,
        session,
        rpc("bad"),
        storage,
      );
    } catch {
      rejected = true;
    }
    assert(rejected, "Invalid server identity accepted");
  });
}

import { DurationStorage } from "../../extension/duration/duration-storage.js";
import { HistorySync } from "../../extension/providers/provider-sync.js";
import {
  pendingDurations,
  acknowledgeDurations,
} from "../../extension/duration/duration-replication.js";
import {
  META_STORE,
  readMetadata,
  writeMetadata,
  transactionDone,
} from "../../extension/history/history-storage.js";
import { summarizeHistory } from "../../extension/history/history-statistics.js";

export async function testDurationSync({
  test,
  database,
  remote,
  open,
  assert,
}) {
  const now = Date.now();
  const row = (strIdent = "abcdefghijk", extra = {}) => ({
    strIdent,
    seconds: 600,
    fetchedAt: now,
    expiresAt: now + 86400000,
    ...extra,
  });
  const storage = (db) =>
    new DurationStorage(() => db, {
      get: async () => ({}),
      set: async () => {},
    });
  await test("a new Mac restores paginated durations without an API key and produces the same watch-time estimates", async () => {
    const cloud = remote();
    const first = await database();
    const second = await database();
    const replacement = await database();
    await storage(first).writeCache([
      row(),
      row("bbbbbbbbbbb"),
      row("ccccccccccc"),
      row("missing____", { seconds: null, unavailable: true }),
      row("live_______", { seconds: null }),
    ]);
    await storage(second).writeCache([row("ddddddddddd")]);
    let refreshed = 0;
    for (const db of [first, second, first, replacement]) {
      const result = await new HistorySync(
        db,
        cloud,
        () => now,
        async () => refreshed++,
      ).sync();
      assert(result.success && !result.inProgress, "Cache restoration failed");
    }
    const expected = await storage(first).readCache(now);
    assert(
      expected.length === 6 && refreshed > 0,
      "Durations or refresh notification missing",
    );
    assert(
      JSON.stringify(expected) ===
        JSON.stringify(await storage(replacement).readCache(now)),
      "Replacement cache differs",
    );
    assert(
      !(await storage(replacement).getConfig()).apiKey,
      "Restoration needs an API key",
    );
    const videos = [
      {
        strIdent: "abcdefghijk",
        strTitle: "Old watch",
        intTimestamp: now - 86400000,
        intCount: 1,
      },
    ];
    const stats = (durations) =>
      summarizeHistory(videos, { now, period: "all", durations }).time.selected;
    assert(
      stats(expected) > 0 &&
        stats(expected) === stats(await storage(replacement).readCache(now)),
      "Historical watch time differs",
    );
    assert(
      (await pendingDurations(replacement)).length === 0,
      "Downloads created an upload loop",
    );
  });
  await test("duration outbox survives lost replies and reopening; old acknowledgements preserve newer fetches", async () => {
    let db = await database();
    const name = db.name;
    await storage(db).writeCache([row()]);
    const sent = await pendingDurations(db);
    await storage(db).writeCache([
      row(undefined, { fetchedAt: now + 1, seconds: 900 }),
    ]);
    await acknowledgeDurations(db, sent);
    assert(
      (await pendingDurations(db))[0].row.seconds === 900,
      "New fetch was acknowledged by old reply",
    );
    const cloud = remote();
    const upload = cloud.importDurations;
    cloud.importDurations = async (rows) => {
      await upload(rows);
      throw new Error("Lost reply");
    };
    assert(
      !(await new HistorySync(db, cloud).sync()).success,
      "Lost reply reported success",
    );
    db.close();
    db = await open(name, 2, () => {});
    assert(
      (await pendingDurations(db)).length === 1,
      "Restart lost duration upload",
    );
    cloud.importDurations = upload;
    assert((await new HistorySync(db, cloud).sync()).success, "Retry failed");
    assert(
      cloud.durations.size === 1 &&
        cloud.durations.get("abcdefghijk").seconds === 900,
      "Retry lost newer duration",
    );
  });
  await test("existing local duration caches upload automatically and repair cloud loss without renewing expiry", async () => {
    const db = await database();
    const cloud = remote();
    const tx = db.transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(META_STORE).put(row(), "video-duration:abcdefghijk");
    tx.objectStore(META_STORE).put(
      { strIdent: "missing____", seconds: null, unavailable: true },
      "video-duration:missing____",
    );
    tx.objectStore(META_STORE).put(
      row("expired____", { fetchedAt: now - 1000, expiresAt: now - 1 }),
      "video-duration:expired____",
    );
    await done;
    assert(
      (await new HistorySync(db, cloud).sync()).success,
      "Existing cache migration failed",
    );
    assert(
      cloud.durations.size === 2 &&
        cloud.durations.get("missing____").fetchedAt === 0,
      "Old skip marker was lost or expired row uploaded",
    );
    cloud.durations.clear();
    await writeMetadata(db, "durationRepair", { after: "", completedAt: 0 });
    await new HistorySync(db, cloud).sync();
    assert(
      cloud.durations.get("abcdefghijk").expiresAt === row().expiresAt,
      "Repair changed original expiry",
    );
    const fresh = await database();
    await new HistorySync(fresh, cloud, () => now + 86400001).sync();
    assert(
      (await storage(fresh).readCache(now + 86400001)).length === 1,
      "Expired cloud metadata was restored",
    );
  });
  await test("stale offline durations and simultaneous observations converge without overwriting newer lengths", async () => {
    const cloud = remote();
    const first = await database();
    const stale = await database();
    await storage(first).writeCache([
      row(undefined, { seconds: 900, fetchedAt: now + 2 }),
    ]);
    await storage(stale).writeCache([row()]);
    for (const db of [first, stale, first])
      await new HistorySync(db, cloud).sync();
    assert(
      (await storage(stale).readCache(now))[0].seconds === 900,
      "Stale Mac replaced newer length",
    );
    await storage(stale).writeCache([
      row(undefined, { seconds: null, unavailable: true, fetchedAt: now + 3 }),
    ]);
    await storage(first).writeCache([
      row(undefined, { seconds: 1000, fetchedAt: now + 3 }),
    ]);
    for (const db of [stale, first, stale, first])
      await new HistorySync(db, cloud).sync();
    assert(
      (await storage(first).readCache(now))[0].unavailable &&
        (await storage(stale).readCache(now))[0].unavailable,
      "Equal-date observations did not converge",
    );
  });
  await test("failed duration pages resume durably; malformed metadata cannot advance cursors; local removal clears uploads", async () => {
    const db = await database();
    const cloud = remote();
    await cloud.importDurations([
      row(),
      row("bbbbbbbbbbb"),
      row("ccccccccccc"),
    ]);
    const page = cloud.getDurationPage;
    cloud.getDurationPage = async (after) => {
      if (after) throw new Error("Interrupted");
      return page(after);
    };
    assert(
      !(await new HistorySync(db, cloud).sync()).success,
      "Interrupted download succeeded",
    );
    assert(
      (await readMetadata(db, "syncWindow:durations")).after === "bbbbbbbbbbb",
      "Download cursor was not committed",
    );
    cloud.getDurationPage = async () => [row("ccccccccccc", { seconds: -1 })];
    assert(
      !(await new HistorySync(db, cloud).sync()).success,
      "Invalid duration accepted",
    );
    assert(
      (await readMetadata(db, "syncWindow:durations")).after === "bbbbbbbbbbb",
      "Invalid page advanced cursor",
    );
    cloud.getDurationPage = page;
    assert(
      (await new HistorySync(db, cloud).sync()).success &&
        (await storage(db).readCache(now)).length === 3,
      "Download did not resume",
    );
    await storage(db).writeCache([row("ddddddddddd")]);
    await storage(db).clearCache();
    assert(
      !(await pendingDurations(db)).length &&
        !(await storage(db).readCache(now)).length,
      "Local removal retained cache/outbox",
    );
    await new HistorySync(db, cloud).sync();
    assert(
      (await storage(db).readCache(now)).length === 3,
      "Explicit cache removal did not allow cloud restoration",
    );
  });
}

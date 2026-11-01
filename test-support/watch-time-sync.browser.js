import { saveWatchTime, readWatchTime } from "../watch-time-storage.js";
import {
  pendingWatchTime,
  acknowledgeWatchTime,
  mergeWatchTimes,
} from "../watch-time-replication.js";
import {
  writeMetadata,
  META_STORE,
  transactionDone,
} from "../history-storage.js";
import { HistorySync } from "../provider-sync.js";

export async function testWatchTimeSync({
  test,
  database,
  remote,
  open,
  assert,
}) {
  const minute = Math.floor((Date.now() - 180000) / 60000) * 60000;
  const sender = { tab: { id: 1 }, documentId: "device-one", frameId: 0 };
  const packet = (
    milliseconds,
    sessionId = "00000000-0000-4000-8000-000000000001",
  ) => ({
    videoId: "abcdefghijk",
    title: "Space",
    sessionId,
    watchedMilliseconds: 60000,
    buckets: [
      { minute, from: minute, to: minute + milliseconds, milliseconds },
    ],
  });
  const total = async (db) =>
    (await readWatchTime(db)).reduce((sum, row) => sum + row.milliseconds, 0);
  await test("duration from two devices converges on every device and a replacement without duplication", async () => {
    const cloud = remote();
    const first = await database();
    const second = await database();
    const replacement = await database();
    await saveWatchTime(first, packet(60000), sender);
    await saveWatchTime(
      second,
      packet(30000, "00000000-0000-4000-8000-000000000002"),
      { ...sender, documentId: "device-two" },
    );
    for (const db of [first, second, first, replacement, second, replacement]) {
      assert(
        (await new HistorySync(db, cloud).sync()).success,
        "Duration sync failed",
      );
    }
    for (const db of [first, second, replacement])
      assert(
        (await total(db)) === 90000,
        "Duration union differs between devices",
      );
    assert(
      cloud.times.size === 2,
      "Downloaded snapshots were uploaded as new plays",
    );
  });
  await test("lost duration replies and database reopen retain retry obligations and newer snapshots", async () => {
    const cloud = remote();
    let db = await database();
    const name = db.name;
    await saveWatchTime(db, packet(1000), sender);
    const sent = await pendingWatchTime(db);
    await saveWatchTime(db, packet(2000), sender);
    await acknowledgeWatchTime(db, sent);
    assert(
      (await pendingWatchTime(db)).length === 1,
      "Old acknowledgement discarded newer time",
    );
    const upload = cloud.importWatchTime;
    let failed = false;
    cloud.importWatchTime = async (rows) => {
      await upload(rows);
      if (!failed) {
        failed = true;
        throw new Error("Lost reply");
      }
      return true;
    };
    assert(
      !(await new HistorySync(db, cloud).sync()).success,
      "Lost reply reported success",
    );
    db.close();
    db = await open(name, 2, () => {});
    assert(
      (await pendingWatchTime(db)).length === 1,
      "Restart lost queued duration",
    );
    assert(
      (await new HistorySync(db, cloud).sync()).success,
      "Duration retry failed",
    );
    assert(
      (await total(db)) === 2000 && cloud.times.size === 1,
      "Retry inflated playback time",
    );
  });
  await test("existing local durations migrate to the shared union and daily repair restores lost cloud rows", async () => {
    const db = await database();
    const cloud = remote();
    const old = packet(30000).buckets[0];
    const tx = db.transaction(META_STORE, "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(META_STORE).put(
      { ...old, strIdent: "abcdefghijk", strTitle: "Existing" },
      `watch-time:1:old-document:00000000-0000-4000-8000-000000000003:${minute}`,
    );
    await done;
    await new HistorySync(db, cloud).sync();
    assert(
      cloud.times.size === 1 && (await total(db)) === 30000,
      "Existing duration was lost or duplicated",
    );
    cloud.times.clear();
    await writeMetadata(db, "watchTimeRepair", { after: "", completedAt: 0 });
    assert(
      (await new HistorySync(db, cloud).sync()).success,
      "Duration repair failed",
    );
    assert(cloud.times.size === 1, "Cloud duration was not reconstructed");
  });
  await test("invalid duration pages do not advance recovery cursors or modify saved snapshots", async () => {
    const db = await database();
    const cloud = remote();
    await saveWatchTime(db, packet(1000), sender);
    const original = cloud.getWatchTimePage;
    cloud.getWatchTimePage = async () => [{ snapshotId: "invalid" }];
    assert(
      !(await new HistorySync(db, cloud).sync()).success,
      "Malformed cloud time accepted",
    );
    assert((await total(db)) === 1000, "Malformed page changed recorded time");
    const row = (await readWatchTime(db))[0];
    let rejected = false;
    try {
      await mergeWatchTimes(db, [
        {
          ...row,
          strIdent: "mnopqrstuvw",
          milliseconds: 2000,
          to: minute + 2000,
        },
      ]);
    } catch {
      rejected = true;
    }
    assert(
      rejected && (await total(db)) === 1000,
      "Snapshot identity collision changed history",
    );
    cloud.getWatchTimePage = original;
    assert(
      (await new HistorySync(db, cloud).sync()).success,
      "Failed duration page did not recover",
    );
  });
}

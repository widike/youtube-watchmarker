import { DATABASE } from "../../extension/shared/constants.js";
import {
  EVENT_STORE,
  readVideos,
} from "../../extension/history/history-event-storage.js";
import { historyEntries } from "../../extension/history/history-events.js";
import { recordPlayback } from "../../extension/history/history-playback.js";
import { HistorySync } from "../../extension/providers/provider-sync.js";
import {
  META_STORE,
  OUTBOX_STORE,
  upgradeHistoryStorage,
  transactionDone,
  saveVideos,
  pendingVideos,
  deleteVideo,
} from "../../extension/history/history-storage.js";

const id = "abcdefghijk";

export async function testWatchEvents({
  test,
  database,
  open,
  remote,
  assert,
}) {
  await test("a clock rollback retains actual watch times separately from the latest summary", async () => {
    const db = await database();
    const now = Date.now;
    try {
      Date.now = () => 200;
      await recordPlayback(db, id, "Title", "first");
      Date.now = () => 100;
      const video = await recordPlayback(db, id, "Title", "second");
      assert(video.intTimestamp === 200, "latest summary moved backwards");
      assert(
        video.watchEvents.some((event) => event.watchedAt === 100),
        "actual watch time was overwritten by summary time",
      );
      await deleteVideo(db, id);
      const restored = await recordPlayback(db, id, "Title", "after-delete");
      assert(
        historyEntries([restored]).length === 1,
        "clock skew hid an explicitly restored watch",
      );
    } finally {
      Date.now = now;
      db.close();
    }
  });
  await test("event upgrade preserves old counts, latest date and retry identities", async () => {
    const name = crypto.randomUUID();
    let db = await open(name, 1, (db) => {
      db.createObjectStore(DATABASE.STORE_NAME, { keyPath: "strIdent" });
      db.createObjectStore(OUTBOX_STORE, { keyPath: "strIdent" });
      db.createObjectStore(META_STORE);
    });
    const tx = db.transaction([DATABASE.STORE_NAME, META_STORE], "readwrite");
    const done = transactionDone(tx);
    tx.objectStore(DATABASE.STORE_NAME).put({
      strIdent: id,
      intTimestamp: 100,
      intCount: 4,
    });
    tx.objectStore(META_STORE).put(["old-play"], `playbacks:${id}`);
    await done;
    db.close();
    db = await open(name, 2, upgradeHistoryStorage);
    assert(db.objectStoreNames.contains(EVENT_STORE), "event store missing");
    const migrated = await readVideos(db, { id });
    assert(migrated.intCount === 4, "migration changed old count");
    assert(migrated.intUnknownCount === 3, "migration fabricated dates");
    assert(
      historyEntries([migrated]).filter((entry) => entry.intTimestamp)
        .length === 1,
      "lost latest date",
    );
    assert(
      (await recordPlayback(db, id, "Title", "old-play")).intCount === 4,
      "old receipt lost",
    );
    const next = await recordPlayback(db, id, "Title", "new-play");
    assert(next.intCount === 5, "new rewatch not counted");
    assert(
      next.watchEvents.some((event) => event.watchedAt === 100),
      "rewatch overwrote old timestamp",
    );
    db.close();
  });

  await test("retry identities survive more than 128 rewatches and database reopen", async () => {
    let db = await database();
    const name = db.name;
    for (let i = 0; i < 135; i++)
      await recordPlayback(db, id, "Title", `session-${i}`);
    db.close();
    db = await open(name, 2, () => {});
    const video = await recordPlayback(db, id, "Title", "session-0");
    assert(video.intCount === 135, "late retry counted another watch");
    assert(video.watchEvents.length === 135, "events were pruned");
    const restored = await database();
    await saveVideos(
      restored,
      JSON.parse(JSON.stringify(await readVideos(db))),
    );
    const copy = (await readVideos(restored))[0];
    assert(
      copy.watchEvents.length === 135 && copy.intCount === 135,
      "backup lost event history",
    );
    db.close();
    restored.close();
  });

  await test("two offline devices retain both rewatch timestamps through cloud restore", async () => {
    const first = await database();
    const second = await database();
    const cloud = remote();
    await recordPlayback(first, id, "Title", "mac-one");
    await recordPlayback(second, id, "Title", "mac-two");
    for (const db of [first, second, first]) {
      assert((await new HistorySync(db, cloud).sync()).success, "sync failed");
    }
    const copy = await database();
    await new HistorySync(copy, cloud).sync();
    const restored = (await readVideos(copy))[0];
    assert(
      restored.intCount === 2 && restored.watchEvents.length === 2,
      "offline event union lost a view",
    );
    assert(
      historyEntries([restored]).length === 2,
      "timeline collapsed rewatches",
    );
    assert(
      (await pendingVideos(first)).length === 0,
      "upload was not acknowledged",
    );
    await deleteVideo(copy, id);
    const next = await recordPlayback(copy, id, "Title", "after-trash");
    assert(
      historyEntries([next]).length === 1,
      "trash restored earlier watches",
    );
    for (const db of [first, second, copy]) db.close();
  });
}

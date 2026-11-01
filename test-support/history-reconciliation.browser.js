import {
  reconcileHistory,
  RECONCILIATION_KEY,
} from "../history-repair-storage.js";
import {
  saveVideos,
  localPage,
  pendingVideos,
  readMetadata,
  writeMetadata,
  OUTBOX_STORE,
  META_STORE,
} from "../history-storage.js";
import {
  previewReconciliation,
  declineReconciliation,
  RECONCILIATION_PLAN,
} from "../history-repair-preview.js";
import { verifyReconciliationCloud } from "../history-repair-sync.js";
import { historyEntries } from "../history-events.js";
import { HistorySync } from "../provider-sync.js";

export async function testHistoryReconciliation({
  test,
  database,
  open,
  remote,
  assert,
}) {
  const now = new Date(2026, 10, 1, 20).getTime();
  const midnight = new Date(2026, 10, 1).getTime();
  const rows = Array.from({ length: 5 }, (_, i) => ({
    strIdent: String(i).padStart(11, "0"),
    strTitle: "Original",
    intTimestamp: now,
    intImportedCount: 2,
    watchEvents: [midnight, now - 1000].map((watchedAt) => ({
      eventId: `saved:${i}:${watchedAt}`,
      watchedAt,
      source: "saved",
      precision: "inferred",
    })),
  }));
  await test("historical import repair commits a durable audit, corrected counts and cloud obligations", async () => {
    let db = await database();
    try {
      await saveVideos(db, rows);
      const plan = await previewReconciliation(db, { now });
      const report = await reconcileHistory(db, {
        planId: plan.id,
        now,
        batchSize: 2,
      });
      assert(
        report.scanned === 5 && report.videos === 5 && report.removed === 5,
        "wrong repair report",
      );
      assert(
        (await localPage(db)).every(
          (video) => video.intCount === 1 && video.watchEvents.length === 3,
        ),
        "counts or original evidence were lost",
      );
      assert(
        (await pendingVideos(db)).every((entry) => entry.video.intCount === 1),
        "corrected summaries not queued",
      );
      const before = JSON.stringify(await pendingVideos(db));
      const name = db.name;
      db.close();
      db = await open(name, 2, () => {});
      assert(
        JSON.stringify(
          await reconcileHistory(db, { planId: plan.id, now, batchSize: 2 }),
        ) === JSON.stringify(report),
        "repair repeated after reopen",
      );
      assert(
        JSON.stringify(await pendingVideos(db)) === before,
        "repeat repair rewrote upload obligations",
      );
    } finally {
      db.close();
    }
  });

  await test("an aborted repair page changes neither history, audit cursor nor pending upload", async () => {
    const db = await database();
    try {
      await saveVideos(db, rows);
      const before = JSON.stringify(await localPage(db));
      const outbox = JSON.stringify(await pendingVideos(db));
      const plan = await previewReconciliation(db, { now });
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === OUTBOX_STORE) this.transaction.abort();
        return originalPut.call(this, value, key);
      };
      try {
        let failed = false;
        try {
          await reconcileHistory(db, { planId: plan.id, now, batchSize: 2 });
        } catch {
          failed = true;
        }
        assert(failed, "aborted repair succeeded");
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      assert(
        JSON.stringify(await localPage(db)) === before,
        "aborted page changed evidence",
      );
      assert(
        JSON.stringify(await pendingVideos(db)) === outbox,
        "aborted page changed outbox",
      );
      assert(
        !(await readMetadata(db, RECONCILIATION_KEY)),
        "aborted page advanced cursor",
      );
      const report = await reconcileHistory(db, {
        planId: plan.id,
        now,
        batchSize: 2,
      });
      assert(report.removed === 5, "retry did not finish repair");
      assert(db.objectStoreNames.contains(META_STORE), "metadata store lost");
    } finally {
      db.close();
    }
  });

  await test("corrections survive cloud sync, stale devices and a fresh machine restore", async () => {
    const first = await database();
    const stale = await database();
    const fresh = await database();
    try {
      const cloud = remote();
      await saveVideos(first, rows);
      await saveVideos(stale, rows);
      const plan = await previewReconciliation(first, { now });
      await reconcileHistory(first, { planId: plan.id, now });
      await new HistorySync(first, cloud, () => now).sync();
      await new HistorySync(stale, cloud, () => now).sync();
      await new HistorySync(fresh, cloud, () => now).sync();
      const restored = await localPage(fresh);
      assert(
        restored.length === 5 &&
          restored.every((video) => video.intCount === 1),
        "stale sync inflated repaired counts",
      );
      assert(
        historyEntries(restored).length === 5,
        "fresh restore repeated imported timeline rows",
      );
      cloud.makeRequest = async (_method, path) => {
        if (path.startsWith("/youtube_watch_history"))
          return new Response(
            JSON.stringify(
              [...cloud.records.values()].map((row) => ({
                str_ident: row.strIdent,
                str_title: row.strTitle,
                int_timestamp: row.intTimestamp,
                int_count: row.intCount,
                int_imported_count: row.intImportedCount,
                int_deleted_at: row.intDeletedAt,
              })),
            ),
          );
        if (new URL(path, "https://fixture.test").searchParams.has("or"))
          return new Response("[]");
        return new Response(
          JSON.stringify(
            [...cloud.records.values()].flatMap((row) =>
              row.watchEvents.map((event) => ({
                str_ident: row.strIdent,
                event_id: event.eventId,
                watched_at: event.watchedAt,
                source: event.source,
                precision: event.precision,
                observed_deletion: event.observedDeletion,
              })),
            ),
          ),
        );
      };
      assert(
        await verifyReconciliationCloud(first, cloud, plan.id),
        "Supabase readback did not verify receipts and counts",
      );
      const firstId = rows[0].strIdent;
      const original = cloud.records.get(firstId);
      cloud.records.set(firstId, { ...original, intCount: 999 });
      assert(
        !(await verifyReconciliationCloud(first, cloud, plan.id)),
        "Inflated server count was falsely verified",
      );
      cloud.records.set(firstId, {
        ...original,
        watchEvents: original.watchEvents.filter(
          (event) => event.source !== "receipt",
        ),
      });
      assert(
        !(await verifyReconciliationCloud(first, cloud, plan.id)),
        "Missing server correction was falsely verified",
      );
      cloud.records.set(firstId, original);
      assert(
        await verifyReconciliationCloud(first, cloud, plan.id),
        "Restored server readback failed",
      );
      await writeMetadata(fresh, "repair", { after: "", completedAt: now });
      assert(
        (await readMetadata(first, RECONCILIATION_KEY)).removed === 5,
        "audit report was lost",
      );
    } finally {
      first.close();
      stale.close();
      fresh.close();
    }
  });

  await test("preview and decline do not change history; missing, stale or declined approvals are rejected", async () => {
    const db = await database();
    try {
      await saveVideos(db, rows);
      const before = JSON.stringify(await localPage(db));
      const pending = JSON.stringify(await pendingVideos(db));
      const plan = await previewReconciliation(db, { now });
      assert(
        plan.removed === 5 &&
          plan.videos === 5 &&
          plan.before === 10 &&
          plan.after === 5,
        "Preview statistics are incorrect",
      );
      assert(
        JSON.stringify(await localPage(db)) === before,
        "Preview changed history",
      );
      assert(
        JSON.stringify(await pendingVideos(db)) === pending,
        "Preview changed upload obligations",
      );
      for (const planId of [undefined, "wrong-token"]) {
        let rejected = false;
        try {
          await reconcileHistory(db, { planId, now });
        } catch {
          rejected = true;
        }
        assert(rejected, "Repair accepted a missing or stale preview token");
      }
      await declineReconciliation(db, plan.id);
      let rejected = false;
      try {
        await reconcileHistory(db, { planId: plan.id, now });
      } catch {
        rejected = true;
      }
      assert(rejected, "Declined repair was applied");
      assert(
        JSON.stringify(await localPage(db)) === before,
        "Decline changed history",
      );
      assert(
        JSON.stringify(await pendingVideos(db)) === pending,
        "Decline changed upload obligations",
      );
    } finally {
      db.close();
    }
  });

  await test("approved repair resumes committed pages and never expands to new unreviewed events", async () => {
    const db = await database();
    try {
      await saveVideos(db, rows);
      const plan = await previewReconciliation(db, { now });
      await saveVideos(db, [
        {
          ...rows[0],
          watchEvents: [
            {
              eventId: "unreviewed-import",
              watchedAt: now - 500,
              source: "saved",
              precision: "inferred",
            },
          ],
        },
      ]);
      const originalPut = IDBObjectStore.prototype.put;
      let uploads = 0;
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === OUTBOX_STORE && ++uploads === 3)
          this.transaction.abort();
        return originalPut.call(this, value, key);
      };
      try {
        try {
          await reconcileHistory(db, { planId: plan.id, now, batchSize: 2 });
        } catch {
          /* interrupted page */
        }
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      const interrupted = await readMetadata(db, RECONCILIATION_KEY);
      assert(
        interrupted.cursor === 2 && interrupted.removed === 2,
        "Committed resume cursor is wrong",
      );
      assert(
        (await readMetadata(db, RECONCILIATION_PLAN)).status === "applying",
        "Approved state was lost",
      );
      const report = await reconcileHistory(db, {
        planId: plan.id,
        now,
        batchSize: 2,
      });
      assert(
        report.removed === 5 && report.videos === 5,
        "Resuming counted a completed page twice",
      );
      const repaired = (await localPage(db))[0];
      assert(
        repaired.intCount === 2,
        "New unreviewed import was silently added to approved scope",
      );
      assert(
        historyEntries([repaired]).some((entry) =>
          entry.entryId.endsWith(":unreviewed-import"),
        ),
        "Unapproved event was suppressed",
      );
    } finally {
      db.close();
    }
  });
}

import { DATABASE } from "./constants.js";
import {
  EVENT_STORE,
  videoEvents,
  putEventVideo,
} from "./history-event-storage.js";
import {
  META_STORE,
  OUTBOX_STORE,
  transactionDone,
} from "./history-storage.js";
import { normalizeVideo, isDeleted } from "./history-records.js";
import { IMPORT_CORRECTION } from "./history-import-corrections.js";
import { RECONCILIATION_PLAN } from "./history-repair-preview.js";

export const RECONCILIATION_KEY = "importReconciliation:v1";
const running = new WeakMap();

// Only the exact event targets in the reviewed plan can be corrected. Newly
// arriving imports never expand the scope of an existing batch approval.
async function repairPage(db, { planId, now, batchSize }) {
  const tx = db.transaction(
    [DATABASE.STORE_NAME, EVENT_STORE, META_STORE, OUTBOX_STORE],
    "readwrite",
    { durability: "strict" },
  );
  const done = transactionDone(tx);
  const metadata = tx.objectStore(META_STORE);
  const request = metadata.get(RECONCILIATION_PLAN);
  let result;
  request.onsuccess = () => {
    const plan = request.result;
    if (
      !plan ||
      plan.id !== planId ||
      !["preview", "applying", "applied"].includes(plan.status)
    ) {
      tx.abort();
      return;
    }
    const reportRequest = metadata.get(RECONCILIATION_KEY);
    reportRequest.onsuccess = () => {
      const stored = reportRequest.result;
      const state =
        stored?.planId === planId
          ? stored
          : {
              planId,
              startedAt: now,
              cursor: 0,
              scanned: 0,
              videos: 0,
              removed: 0,
            };
      if (state.completedAt) {
        result = state;
        return;
      }
      const page = plan.items.slice(state.cursor, state.cursor + batchSize);
      let pending = page.length;
      const finish = () => {
        state.cursor += page.length;
        plan.status =
          state.cursor >= plan.items.length ? "applied" : "applying";
        if (plan.status === "applied") state.completedAt = now;
        metadata.put(state, RECONCILIATION_KEY);
        metadata.put(plan, RECONCILIATION_PLAN);
        result = state;
      };
      if (!pending) {
        finish();
        return;
      }
      for (const item of page) {
        const read = tx.objectStore(DATABASE.STORE_NAME).get(item.strIdent);
        read.onsuccess = () =>
          videoEvents(tx, item.strIdent, (watchEvents) => {
            try {
              state.scanned++;
              if (read.result) {
                const previous = normalizeVideo({
                  ...read.result,
                  watchEvents,
                });
                if (
                  !isDeleted(previous) &&
                  previous.intDeletedAt === item.intDeletedAt
                ) {
                  const existing = new Map(
                    watchEvents.map((event) => [event.eventId, event]),
                  );
                  const approved = item.corrections.filter(
                    (event) =>
                      !existing.has(event.eventId) &&
                      existing.get(
                        event.eventId.slice(IMPORT_CORRECTION.length),
                      )?.source === "saved",
                  );
                  if (approved.length) {
                    const video = normalizeVideo({
                      ...previous,
                      watchEvents: [...watchEvents, ...approved],
                    });
                    putEventVideo(tx, video);
                    tx.objectStore(OUTBOX_STORE).put({
                      strIdent: video.strIdent,
                      revision: crypto.randomUUID(),
                      video,
                    });
                    state.videos++;
                    state.removed += approved.length;
                  }
                }
              }
              if (!--pending) finish();
            } catch {
              tx.abort();
            }
          });
      }
    };
  };
  await done;
  return result;
}

/** The caller supplies the preview token only after a single batch approval. */
export function reconcileHistory(
  db,
  { planId, now = Date.now(), batchSize = 200 } = {},
) {
  if (typeof planId !== "string" || !planId)
    return Promise.reject(new Error("Preview and approve the batch first."));
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    return Promise.reject(new Error("Invalid reconciliation batch size"));
  const active = running.get(db);
  if (active && active.planId !== planId)
    return Promise.reject(new Error("Another approved repair is running."));
  if (!active) {
    const promise = (async () => {
      let report;
      do {
        report = await repairPage(db, { planId, now, batchSize });
      } while (!report.completedAt);
      return report;
    })().finally(() => running.delete(db));
    running.set(db, { planId, promise });
  }
  return running.get(db).promise;
}

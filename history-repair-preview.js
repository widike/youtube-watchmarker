import { readVideos } from "./history-event-storage.js";
import {
  readMetadata,
  META_STORE,
  transactionDone,
} from "./history-storage.js";
import { normalizeVideo, isDeleted } from "./history-records.js";
import { countedEvents } from "./history-events.js";
import { reconcileImportedVideo } from "./history-reconciliation.js";

export const RECONCILIATION_PLAN = "importReconciliationPlan:v1";

export function buildReconciliationPlan(videos, now = Date.now()) {
  const plan = {
    id: crypto.randomUUID(),
    status: "preview",
    createdAt: now,
    scanned: videos.length,
    before: 0,
    after: 0,
    removed: 0,
    playbacks: 0,
    undated: 0,
    items: [],
  };
  for (const input of videos) {
    const video = normalizeVideo(input);
    if (isDeleted(video)) continue;
    const repaired = reconcileImportedVideo(video, now);
    plan.before += video.intCount;
    plan.after += repaired.video.intCount;
    plan.playbacks += countedEvents(video.watchEvents).filter(
      (event) => event.source === "playback",
    ).length;
    plan.undated += video.intUnknownCount;
    if (!repaired.removed) continue;
    const existing = new Set(video.watchEvents.map((event) => event.eventId));
    plan.items.push({
      strIdent: video.strIdent,
      strTitle: video.strTitle,
      intDeletedAt: video.intDeletedAt,
      before: video.intCount,
      after: repaired.video.intCount,
      corrections: repaired.video.watchEvents.filter(
        (event) => !existing.has(event.eventId),
      ),
    });
    plan.removed += repaired.removed;
  }
  return plan;
}

export function publicReconciliationPlan(plan) {
  if (!plan) return null;
  const { items, ...summary } = plan;
  return {
    ...summary,
    videos: items.length,
    examples: items.slice(0, 10).map(({ corrections, ...row }) => ({
      ...row,
      removed: corrections.length,
    })),
  };
}

export async function previewReconciliation(db, { now = Date.now() } = {}) {
  const existing = await readMetadata(db, RECONCILIATION_PLAN);
  if (existing?.status === "applying")
    throw new Error(
      "Resume the approved repair before creating another preview.",
    );
  const plan = buildReconciliationPlan(await readVideos(db), now);
  // Approval can arrive from another window while the read-only scan runs.
  // Never replace its persisted resume plan with this newer preview.
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  const request = store.get(RECONCILIATION_PLAN);
  request.onsuccess = () => {
    if (request.result?.status === "applying") {
      tx.abort();
      return;
    }
    store.put(plan, RECONCILIATION_PLAN);
  };
  await done;
  return publicReconciliationPlan(plan);
}

export async function declineReconciliation(db, planId) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  const request = store.get(RECONCILIATION_PLAN);
  request.onsuccess = () => {
    const plan = request.result;
    if (!plan || plan.id !== planId || plan.status !== "preview") {
      tx.abort();
      return;
    }
    store.put({ ...plan, status: "declined" }, RECONCILIATION_PLAN);
  };
  await done;
}

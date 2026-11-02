import {
  readMetadata,
  META_STORE,
  transactionDone,
} from "./history-storage.js";
import { readVideos } from "./history-event-storage.js";
import { RECONCILIATION_PLAN } from "./history-repair-preview.js";
import { RECONCILIATION_KEY } from "./history-repair-storage.js";
import { normalizeVideo } from "./history-records.js";
import { downloadWatchEvents } from "../providers/supabase-watch-events.js";
import { credentialStorage } from "../providers/credential-storage.js";

async function saveVerification(db, planId, verifiedAt) {
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  const request = store.get(RECONCILIATION_PLAN);
  let saved = false;
  request.onsuccess = () => {
    if (request.result?.id !== planId || request.result.status !== "applied")
      return;
    const reportRequest = store.get(RECONCILIATION_KEY);
    reportRequest.onsuccess = () => {
      const report = reportRequest.result;
      if (report?.planId !== planId) return;
      if (verifiedAt) report.cloudVerifiedAt = verifiedAt;
      else delete report.cloudVerifiedAt;
      store.put(report, RECONCILIATION_KEY);
      saved = true;
    };
  };
  await done;
  return saved;
}

export async function reconciliationCloudStatus(factory, remote) {
  try {
    if (!(await factory.isConfigured()))
      throw new Error("Connect Supabase before approving this repair.");
    const [configuration, session] = await Promise.all([
      credentialStorage.getConfiguration(),
      credentialStorage.getSession(),
    ]);
    if (!configuration || !session)
      throw new Error("Connect Supabase before approving this repair.");
    await factory.assertIdentity(configuration, session);
    const sync = await factory.getProviderStatus();
    if (sync.inProgress || sync.error || !sync.lastSuccess)
      return {
        ready: false,
        error:
          "Finish a successful Supabase history sync before approving this repair.",
      };
    const response = await remote.makeRequest(
      "POST",
      "/rpc/watchmarker_import_reconciliation_version",
      {},
    );
    if ((await response.json()) !== 1)
      throw new Error("Unsupported reconciliation schema.");
    return { ready: true };
  } catch {
    return {
      ready: false,
      error:
        "Connect Supabase and apply the import-reconciliation SQL migration before approving. Copy setup SQL includes this migration.",
    };
  }
}

// Successful upload alone is not readback. Check the server's stored summary
// and every applied correction receipt before claiming Supabase is verified.
export async function verifyReconciliationCloud(db, remote, planId) {
  const plan = await readMetadata(db, RECONCILIATION_PLAN);
  const report = await readMetadata(db, RECONCILIATION_KEY);
  if (
    !plan ||
    plan.id !== planId ||
    plan.status !== "applied" ||
    report?.planId !== planId
  )
    throw new Error("The approved repair has not finished.");
  if (report.cloudVerifiedAt) {
    if (!(await saveVerification(db, planId, 0))) return false;
  }
  for (let offset = 0; offset < plan.items.length; offset += 20) {
    const items = plan.items.slice(offset, offset + 20);
    const local = await Promise.all(
      items.map((item) => readVideos(db, { id: item.strIdent })),
    );
    const params = new URLSearchParams({
      select:
        "str_ident,str_title,int_timestamp,int_count,int_imported_count,int_deleted_at",
      str_ident: `in.(${items.map((item) => JSON.stringify(item.strIdent)).join(",")})`,
    });
    const response = await remote.makeRequest(
      "GET",
      `/youtube_watch_history?${params}`,
    );
    const summaries = await response.json();
    const records = summaries.map((row) => ({
      strIdent: row.str_ident,
      strTitle: row.str_title,
      intTimestamp: Number(row.int_timestamp),
      intCount: Number(row.int_count),
      intImportedCount: Number(row.int_imported_count),
      intDeletedAt: Number(row.int_deleted_at),
    }));
    const downloaded = new Map(
      (await downloadWatchEvents(remote, records)).map((row) => [
        row.strIdent,
        row,
      ]),
    );
    for (const [index, item] of items.entries()) {
      const row = downloaded.get(item.strIdent);
      if (!row || normalizeVideo(row).intCount !== row.intCount) return false;
      const received = new Set(row.watchEvents.map((event) => event.eventId));
      const saved = new Set(
        (local[index]?.watchEvents || []).map((event) => event.eventId),
      );
      if (
        item.corrections.some(
          (event) => saved.has(event.eventId) && !received.has(event.eventId),
        )
      )
        return false;
    }
  }
  return saveVerification(db, planId, Date.now());
}

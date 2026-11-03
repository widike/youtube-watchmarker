import { credentialStorage } from "./credential-storage.js";
import {
  META_STORE,
  readMetadata,
  transactionDone,
} from "../history/history-storage.js";

// Membership in Supabase is authoritative. A repaired self-owned installation
// may adopt its server-linked history; unrelated/project switches stay blocked.
export async function resolveCloudIdentity(
  db,
  configuration,
  session,
  remote,
  storage = credentialStorage,
) {
  const owner = await (
    await remote.makeRequest("POST", "/rpc/watchmarker_history_owner", {})
  ).json();
  if (
    typeof owner !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(owner)
  )
    throw new Error("The sync service returned an invalid history identity");
  const identity = `${configuration.projectId}:${owner}`;
  const bound = await readMetadata(db, "cloudIdentity");
  if (
    bound &&
    bound !== identity &&
    bound !== `${configuration.projectId}:${session.userId}`
  )
    throw new Error(
      "This history belongs to a different connection. Use a code from a device connected to the original history.",
    );
  if (session.historyOwnerId !== owner) {
    // The RPC may have rotated the refresh token. Never write the stale session
    // captured before that request back over the refreshed credentials.
    const current = await storage.getSession();
    if (!current || current.userId !== session.userId)
      throw new Error("The device session changed while checking its history");
    await storage.storeSession({ ...current, historyOwnerId: owner });
  }
  const tx = db.transaction(META_STORE, "readwrite", { durability: "strict" });
  const done = transactionDone(tx);
  const store = tx.objectStore(META_STORE);
  if (bound && bound !== identity) {
    // Old cursors and repair receipts describe a different remote namespace.
    for (const key of [
      "downloadAfter",
      "lastDownload",
      "repair",
      "watchTimeDownloadAfter",
      "watchTimeLastDownload",
      "watchTimeRepair",
      "durationDownloadAfter",
      "durationLastDownload",
      "durationRepair",
      "syncStatus",
    ])
      store.delete(key);
  }
  store.put(identity, "cloudIdentity");
  await done;
  return identity;
}

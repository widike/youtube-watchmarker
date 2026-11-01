import { Database } from "../bg-database.js";
import { databaseProviderFactory as factory } from "../database-provider-factory.js";
import { supabaseDatabaseProvider as remote } from "../supabase-database-provider.js";
import { createHandler } from "../handler-wrapper.js";
import { readMetadata } from "../history-storage.js";
import {
  previewReconciliation,
  declineReconciliation,
  publicReconciliationPlan,
  RECONCILIATION_PLAN,
} from "../history-repair-preview.js";
import {
  reconcileHistory,
  RECONCILIATION_KEY,
} from "../history-repair-storage.js";
import {
  reconciliationCloudStatus,
  verifyReconciliationCloud,
} from "../history-repair-sync.js";

export const handleHistoryReconciliation = createHandler(
  async (request) => {
    const db = Database.database;
    const operation = request.operation || "status";
    if (operation === "preview") {
      const plan = await previewReconciliation(db);
      return { plan, cloud: await reconciliationCloudStatus(factory, remote) };
    }
    if (operation === "decline")
      await declineReconciliation(db, request.planId);
    else if (["approve", "sync"].includes(operation)) {
      const cloud = await reconciliationCloudStatus(factory, remote);
      if (!cloud.ready) throw new Error(cloud.error);
      if (operation === "approve")
        await reconcileHistory(db, { planId: request.planId });
      else {
        const plan = await readMetadata(db, RECONCILIATION_PLAN);
        if (plan?.id !== request.planId || plan.status !== "applied")
          throw new Error("No approved repair is ready to sync.");
      }
      let verified = false;
      let sync;
      try {
        sync = await factory.performDeltaSync({ forceDownload: true });
        verified =
          sync.success &&
          (await verifyReconciliationCloud(db, remote, request.planId));
      } catch (error) {
        // The approved local transaction is already durable. Show pending sync
        // and its retry action instead of returning a stale approval preview.
        sync = { success: false, error: error.message };
      }
      return {
        plan: publicReconciliationPlan(
          await readMetadata(db, RECONCILIATION_PLAN),
        ),
        report: await readMetadata(db, RECONCILIATION_KEY),
        cloud,
        sync: { verified: Boolean(verified), error: sync.error || null },
      };
    } else if (operation !== "status")
      throw new Error("Invalid reconciliation operation.");
    return {
      plan: publicReconciliationPlan(
        await readMetadata(db, RECONCILIATION_PLAN),
      ),
      report: await readMetadata(db, RECONCILIATION_KEY),
      cloud: await reconciliationCloudStatus(factory, remote),
    };
  },
  { name: "handleHistoryReconciliation" },
);

import { escape, number } from "../../ui/statistics-format.js";

export class ReconciliationController {
  constructor({ root, client, onDataChanged }) {
    Object.assign(this, { root, client, onDataChanged });
  }

  initialize() {
    this.root.addEventListener("click", (event) => {
      if (event.target.closest("[data-reconcile-copy]"))
        void this.copyMigration();
      const button = event.target.closest("[data-reconcile]");
      if (button) void this.run(button.dataset.reconcile);
    });
    void this.run("status");
  }

  async copyMigration() {
    const status = this.root.querySelector("[data-reconcile-status]");
    try {
      const response = await fetch(
        chrome.runtime.getURL(
          "supabase/migrations/20261101030000_import_reconciliation.sql",
        ),
      );
      if (!response.ok) throw new Error("Repair SQL could not be loaded.");
      await navigator.clipboard.writeText(await response.text());
      status.textContent = "SQL copied. Run in Supabase SQL Editor.";
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async run(operation) {
    if (this.busy) return;
    this.busy = true;
    this.root
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = true));
    const status = this.root.querySelector("[data-reconcile-status]");
    if (operation !== "status")
      status.textContent =
        operation === "preview"
          ? "Checking…"
          : operation === "decline"
            ? "Declining…"
            : "Applying…";
    try {
      const response = await this.client.sendMessage({
        action: "history-reconcile",
        operation,
        planId: this.plan?.id,
      });
      if (!response?.success)
        throw new Error(response?.error || "Reconciliation failed.");
      this.plan = response.plan;
      this.render(response);
      if (["approve", "sync"].includes(operation)) await this.onDataChanged();
    } catch (error) {
      status.textContent = error.message;
      this.root
        .querySelectorAll("button")
        .forEach((button) => (button.disabled = false));
    } finally {
      this.busy = false;
    }
  }

  render({ plan, cloud, report, sync }) {
    const content = this.root.querySelector("[data-reconcile-preview]");
    const status = this.root.querySelector("[data-reconcile-status]");
    this.root.querySelector("[data-reconcile-copy]").disabled = false;
    this.root.querySelector('[data-reconcile="preview"]').disabled =
      plan?.status === "applying";
    if (!plan) {
      content.innerHTML = "";
      status.textContent = "";
      return;
    }
    if (plan.status === "declined") {
      content.innerHTML = "";
      status.textContent = "Batch declined";
      return;
    }
    const approved = ["applying", "applied"].includes(plan.status);
    content.innerHTML = `<dl class="summary-list"><dt>Exclude imports</dt><dd>${number(plan.removed)}</dd>
      <dt>Videos</dt><dd>${number(plan.videos)} of ${number(plan.scanned)}</dd>
      <dt>Watch counts</dt><dd>${number(plan.before)} → ${number(plan.after)}</dd>
      <dt>Playback sessions</dt><dd>${number(plan.playbacks)}</dd>
      <dt>Undated counts</dt><dd>${number(plan.undated)}</dd></dl>
      ${plan.examples.length ? `<details><summary>Examples (${plan.examples.length} of ${number(plan.videos)})</summary><ul>${plan.examples.map((row) => `<li>${escape(row.strTitle || row.strIdent)} · ${number(row.before)} → ${number(row.after)}</li>`).join("")}</ul></details>` : ""}
      <div class="toolbar-actions">${
        plan.status === "applied"
          ? '<button class="quiet-button" data-reconcile="sync">Verify sync</button>'
          : `<button class="quiet-button" data-reconcile="approve" title="Exclude redundant imports; original events retained" ${!cloud?.ready || !plan.removed ? "disabled" : ""}>${approved ? "Resume batch" : "Approve batch"}</button>${!approved ? '<button class="quiet-button" data-reconcile="decline">Decline batch</button>' : ""}`
      }</div>`;
    if (plan.status === "applied")
      status.textContent = (sync ? sync.verified : report?.cloudVerifiedAt)
        ? `${number(report.removed)} reconciled · sync verified`
        : `Saved · sync verification pending${sync?.error ? ` · ${sync.error}` : ""}`;
    else if (plan.status === "applying")
      status.textContent = "Batch incomplete · resume to continue";
    else
      status.textContent = cloud?.ready
        ? ""
        : cloud?.error || "Supabase is not ready.";
  }
}

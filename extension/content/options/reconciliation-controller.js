import { escape, number } from "../../ui/statistics-format.js";

const count = (value, singular, plural = `${singular}s`) =>
  `${number(value)} ${value === 1 ? singular : plural}`;

export class ReconciliationController {
  constructor({ root, client, onDataChanged }) {
    Object.assign(this, { root, client, onDataChanged });
    this.response = {};
  }

  initialize() {
    this.root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-reconcile]");
      if (button && !button.disabled) void this.run(button.dataset.reconcile);
    });
    void this.run("status");
  }

  async run(operation) {
    if (this.busy) return;
    this.busy = true;
    const primary = this.root.querySelector("[data-reconcile-primary]");
    const restoreFocus = this.root.contains(document.activeElement);
    this.root.setAttribute("aria-busy", "true");
    this.root
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = true));
    const status = this.root.querySelector("[data-reconcile-status]");
    const progress = {
      status: "Loading…",
      preview: "Checking imports…",
      decline: "Cancelling…",
      approve: "Cleaning up and syncing…",
      sync: "Retrying sync…",
    }[operation];
    primary.innerHTML = `<span class="busy-spinner" aria-hidden="true"></span>${escape(primary.textContent.trim())}`;
    status.textContent = progress;
    try {
      const response = await this.client.sendMessage({
        action: "history-reconcile",
        operation,
        planId: this.response.plan?.id,
      });
      if (!response?.success)
        throw new Error(response?.error || "Cleanup could not be completed.");
      this.response = response;
      this.render();
      if (["approve", "sync"].includes(operation)) await this.onDataChanged();
    } catch (error) {
      this.render();
      if (operation === "status") {
        primary.dataset.reconcile = "status";
        primary.textContent = "Try again";
      }
      status.textContent = error.message;
      status.dataset.error = "true";
    } finally {
      this.busy = false;
      this.root.setAttribute("aria-busy", "false");
      if (restoreFocus) primary.focus();
    }
  }

  render() {
    const { plan, cloud, report, sync } = this.response;
    const content = this.root.querySelector("[data-reconcile-preview]");
    const status = this.root.querySelector("[data-reconcile-status]");
    const primary = this.root.querySelector("[data-reconcile-primary]");
    const cancel = this.root.querySelector('[data-reconcile="decline"]');
    const applied = plan?.status === "applied";
    const applying = plan?.status === "applying";
    const preview = plan?.status === "preview";
    const verified = Boolean(sync ? sync.verified : report?.cloudVerifiedAt);
    const needsSync = applied && !verified;
    const hasChanges = preview && plan.removed > 0;
    const blocked = (hasChanges || applying || needsSync) && !cloud?.ready;

    primary.dataset.reconcile =
      hasChanges || applying ? "approve" : needsSync ? "sync" : "preview";
    primary.textContent = applying
      ? "Resume cleanup"
      : hasChanges
        ? "Clean up imports"
        : needsSync
          ? "Retry sync"
          : plan && plan.status !== "declined"
            ? "Check again"
            : "Check imports";
    primary.disabled = false;
    cancel.hidden = !hasChanges;
    cancel.disabled = false;
    status.dataset.error = "false";
    status.textContent = blocked
      ? cloud?.error || "Finish setting up Cloud sync above, then check again."
      : plan?.status === "declined"
        ? "Cancelled. No changes made."
        : "";
    // A blocked preview still needs a way to recheck readiness after setup.
    if (blocked) {
      primary.dataset.reconcile = applying || needsSync ? "status" : "preview";
      primary.textContent = "Check again";
    }

    if (!plan || plan.status === "declined") {
      content.innerHTML = "";
      return;
    }
    const title = applied
      ? "Cleanup complete"
      : applying
        ? "Cleanup paused"
        : hasChanges
          ? `${count(plan.removed, "duplicate watch", "duplicate watches")} found`
          : "No duplicate imports found";
    const description = applied
      ? `${count(report?.removed ?? plan.removed, "duplicate watch", "duplicate watches")} removed. ${verified ? "Cloud sync verified." : "Saved on this device. Cloud sync is pending."}`
      : applying
        ? "Continue the cleanup you already approved."
        : hasChanges
          ? `Watch counts will be corrected for ${count(plan.videos, "video")}.`
          : "Your imported watch counts are up to date.";
    const showExamples = hasChanges || applying;
    const detailsOpen = content.querySelector("details")?.open;
    content.innerHTML = `
      <div class="reconciliation-result" data-complete="${applied || (preview && !hasChanges)}">
        <span class="reconciliation-icon" aria-hidden="true"><i class="fas ${applied || (preview && !hasChanges) ? "fa-check" : "fa-layer-group"}"></i></span>
        <div><h3>${title}</h3><p>${description}</p></div>
      </div>
      ${showExamples && plan.examples?.length ? this.examples(plan, detailsOpen) : ""}`;
    if (needsSync && sync?.error) {
      status.textContent = sync.error;
      status.dataset.error = "true";
    }
  }

  examples(plan, open) {
    return `<details class="reconciliation-examples" ${open ? "open" : ""}>
      <summary>Review affected videos${plan.videos > plan.examples.length ? ` · first ${number(plan.examples.length)}` : ""}</summary>
      <ul>${plan.examples
        .map(
          (row) => `<li><span>${escape(row.strTitle || row.strIdent)}</span>
          <span class="reconciliation-count" aria-label="${number(row.before)} watches before, ${number(row.after)} after">${number(row.before)} <span aria-hidden="true">→</span> ${number(row.after)}</span></li>`,
        )
        .join("")}</ul>
    </details>`;
  }
}

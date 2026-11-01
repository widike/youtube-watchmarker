import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";

const SOURCES = ["history", "youtube", "likes"];
const numberFormat = new Intl.NumberFormat();

export class SourcePreviewController {
  constructor({ client, root = document }) {
    this.client = client;
    this.root = root;
    this.button = root.getElementById("refresh-sources");
    this.run = null;
  }

  initialize() {
    this.button.addEventListener("click", () => {
      if (this.run) void this.cancel();
      else void this.refresh();
    });
    window.addEventListener("pagehide", () => void this.cancel(), {
      once: true,
    });
    this.invalidate();
  }

  invalidate() {
    void this.cancel();
    for (const source of SOURCES) {
      this.root.getElementById(`source-${source}-metrics`).hidden = true;
      const status = this.root.getElementById(`source-${source}-status`);
      status.classList.remove("source-error");
      status.textContent = "Not checked";
    }
  }

  async cancel() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    this.resetButton();
    for (const source of run.pending) {
      this.root.getElementById(`source-${source}-status`).textContent =
        "Cancelled";
    }
    try {
      const response = await this.client.sendMessage({
        action: "source-preview-cancel",
        requestId: run.id,
      });
      if (!response?.success)
        throw new Error(response?.error || "Cancellation failed");
    } catch (error) {
      for (const source of run.pending) {
        const status = this.root.getElementById(`source-${source}-status`);
        // A newer check owns the status now.
        if (status.textContent !== "Cancelled") continue;
        status.classList.add("source-error");
        status.textContent = `Could not cancel check: ${error.message}`;
      }
    }
  }

  resetButton() {
    clearButtonBusy(this.button);
    this.button.setAttribute("aria-label", "Check sources");
    this.button.title = "Check sources";
  }

  async refresh() {
    if (this.run) return;
    const run = { id: crypto.randomUUID(), pending: new Set(SOURCES) };
    this.run = run;
    setButtonBusy(this.button, "Cancel check");
    this.button.disabled = false;
    this.button.setAttribute("aria-label", "Cancel source check");
    this.button.title = "Cancel source check";
    try {
      await Promise.all(SOURCES.map((source) => this.check(source, run)));
    } finally {
      if (this.run === run) {
        this.run = null;
        this.resetButton();
      }
    }
  }

  async check(source, run) {
    const metrics = this.root.getElementById(`source-${source}-metrics`);
    const status = this.root.getElementById(`source-${source}-status`);
    metrics.hidden = true;
    status.classList.remove("source-error");
    status.textContent = "Checking…";
    try {
      const response = await this.client.sendMessage({
        action: "source-preview",
        source,
        requestId: run.id,
      });
      if (this.run !== run) return;
      if (!response?.success) {
        throw new Error(response?.error || "Source could not be checked.");
      }
      const { preview } = response;
      metrics.querySelectorAll("[data-count]").forEach((element) => {
        element.textContent = numberFormat.format(
          preview[element.dataset.count],
        );
      });
      metrics.hidden = false;
      status.textContent = preview.unknownTimestampCount
        ? `${numberFormat.format(preview.unknownTimestampCount)} entries without a source date excluded`
        : "";
    } catch (error) {
      if (this.run !== run) return;
      status.classList.add("source-error");
      status.textContent = error.message;
    } finally {
      run.pending.delete(source);
    }
  }
}

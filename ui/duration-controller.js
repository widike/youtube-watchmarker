export class DurationController {
  constructor({ root, client }) {
    Object.assign(this, { root, client });
    this.form = root.querySelector("[data-duration-form]");
    this.status = root.querySelector("[data-duration-status]");
    this.generation = 0;
    this.onShow = () => void this.refresh();
    this.onInput = () => this.updateSubmitLabel();
    this.onSubmit = (event) => {
      event.preventDefault();
      void this.control("start");
    };
    this.onClick = (event) => {
      const button = event.target.closest("[data-duration-command]");
      if (button) void this.control(button.dataset.durationCommand);
    };
  }

  initialize() {
    this.form.addEventListener("submit", this.onSubmit);
    this.form.addEventListener("click", this.onClick);
    this.form.addEventListener("input", this.onInput);
    window.addEventListener("hashchange", this.onShow);
    window.addEventListener("focus", this.onShow);
    document.addEventListener("visibilitychange", this.onShow);
    this.onShow();
  }

  show(backfill) {
    this.backfill = backfill;
    const {
      available,
      total,
      unavailable,
      enabled,
      configured,
      status,
      nextAttemptAt,
    } = backfill;
    const messages = {
      paused: "Paused",
      queued: "Queued",
      fetching: "Fetching…",
      running: "Running",
      complete: "Up to date",
      quota: "Daily quota reached",
      retry: "Waiting to retry",
      error: backfill.error || "Backfill needs attention",
    };
    const retry =
      enabled && ["quota", "retry"].includes(status) && nextAttemptAt
        ? ` · Next attempt ${new Date(nextAttemptAt).toLocaleString()}`
        : "";
    this.status.textContent = configured
      ? `${messages[status] || "Ready"} · ${available.toLocaleString()} / ${total.toLocaleString()} videos${unavailable ? ` · ${unavailable.toLocaleString()} unavailable` : ""}${retry}`
      : "";
    this.root.querySelector(".duration-api-link").hidden = configured;
    const input = this.form.querySelector("input");
    input.placeholder = configured ? "Replace saved key" : "";
    input.required = !configured;
    this.updateSubmitLabel();
    this.form.querySelector('[data-duration-command="pause"]').disabled =
      !enabled;
    this.form.querySelector('[data-duration-command="forget"]').disabled =
      !configured;
  }

  updateSubmitLabel() {
    const configured = this.backfill?.configured;
    const hasNewKey = Boolean(this.form.querySelector("input").value.trim());
    this.form.querySelector('[type="submit"]').textContent = configured
      ? hasNewKey
        ? "Save & resume"
        : "Resume"
      : "Save & start";
  }

  async refresh() {
    clearTimeout(this.timer);
    if (this.disposed || this.root.hidden || document.hidden || this.busy)
      return;
    const generation = ++this.generation;
    try {
      const response = await this.client.sendMessage({
        action: "duration-status",
      });
      if (
        this.disposed ||
        generation !== this.generation ||
        !response?.success ||
        !response.backfill
      )
        return;
      this.show(response.backfill);
    } catch {
      if (!this.disposed && generation === this.generation)
        this.status.textContent = "Could not load duration progress.";
    } finally {
      if (
        !this.disposed &&
        generation === this.generation &&
        !this.root.hidden &&
        !document.hidden
      )
        this.timer = setTimeout(() => void this.refresh(), 5000);
    }
  }

  async control(command) {
    if (this.busy || this.disposed) return;
    this.busy = true;
    this.generation++;
    clearTimeout(this.timer);
    const input = this.form.querySelector("input");
    input.disabled = true;
    const buttons = [...this.form.querySelectorAll("button")];
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const apiKey = command === "start" ? input.value.trim() : "";
      const response = await this.client.sendMessage({
        action: "duration-control",
        command,
        ...(apiKey ? { apiKey } : {}),
      });
      if (!response?.success || !response.backfill)
        throw new Error(
          response?.error || "Could not update duration backfill.",
        );
      if (this.disposed) return;
      input.value = "";
      this.show(response.backfill);
    } catch (error) {
      if (!this.disposed) this.status.textContent = error.message;
    } finally {
      this.busy = false;
      input.disabled = false;
      buttons.forEach((button) => {
        button.disabled = false;
      });
      if (this.backfill) {
        this.form.querySelector('[data-duration-command="pause"]').disabled =
          !this.backfill.enabled;
        this.form.querySelector('[data-duration-command="forget"]').disabled =
          !this.backfill.configured;
      }
      if (!this.disposed)
        this.timer = setTimeout(() => void this.refresh(), 5000);
    }
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.form.removeEventListener("submit", this.onSubmit);
    this.form.removeEventListener("click", this.onClick);
    this.form.removeEventListener("input", this.onInput);
    window.removeEventListener("hashchange", this.onShow);
    window.removeEventListener("focus", this.onShow);
    document.removeEventListener("visibilitychange", this.onShow);
  }
}

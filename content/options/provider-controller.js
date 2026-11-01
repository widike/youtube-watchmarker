import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";

export class ProviderController {
  constructor({ client, elements, onDataChanged }) {
    Object.assign(this, { client, elements, onDataChanged });
    this.connected = false;
    this.busy = false;
  }

  bindEvents() {
    const e = this.elements;
    e.connectDeviceForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.connectDevice("code");
    });
    e.projectSetupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.connectDevice("project");
    });
    e.syncSetupToggle.addEventListener("click", () => {
      this.showSetup = !this.showSetup;
      e.syncSetup.hidden = !this.showSetup;
      e.projectSetup.open = this.showSetup;
      e.syncSetupToggle.setAttribute("aria-expanded", String(this.showSetup));
    });
    for (const input of [
      e.connectionCode,
      e.supabaseProjectId,
      e.supabaseApiKey,
    ])
      input.addEventListener("input", () => this.updateButtons());
    e.setupSqlButton.addEventListener("click", () => void this.copySetupSql());
    e.createLinkButton.addEventListener(
      "click",
      () => void this.createConnectionCode(),
    );
    e.copyConnectionCodeButton.addEventListener(
      "click",
      () => void this.copyConnectionCode(),
    );
    this.poll = setInterval(() => void this.updateProviderStatus(), 5000);
    window.addEventListener(
      "pagehide",
      () => {
        clearInterval(this.poll);
        this.clearConnectionCode();
      },
      { once: true },
    );
    this.updateButtons();
  }

  updateButtons() {
    const e = this.elements;
    e.connectDeviceButton.disabled =
      this.busy || !e.connectionCode.value.trim();
    e.startSyncButton.disabled =
      this.busy ||
      !e.supabaseProjectId.value.trim() ||
      !e.supabaseApiKey.value.trim();
    e.createLinkButton.disabled = this.busy;
  }

  async updateProviderStatus() {
    const e = this.elements;
    try {
      const response = await this.client.sendMessage({
        action: "database-provider-status",
      });
      if (!response?.success)
        throw new Error(response?.error || "Status unavailable");
      const status = response.status;
      this.connected = Boolean(status.configured);
      e.syncSetup.hidden = this.connected && !this.showSetup;
      e.syncSetupToggle.hidden = !this.connected;
      e.connectDeviceForm.hidden = this.connected;
      e.projectFields.hidden = this.connected;
      e.startSyncButton.hidden = this.connected;
      e.projectSetupLabel.textContent = this.connected
        ? "Database setup"
        : "First device setup";
      e.syncConnected.hidden = !this.connected;
      e.syncDatabaseButton.hidden = !this.connected;
      e.syncDatabaseButton.disabled = !this.connected;
      e.syncSummary.classList.toggle("sync-attention", Boolean(status.error));
      let message = "Local only";
      if (this.connected) {
        if (status.error) message = `Sync paused · ${status.error}`;
        else if (status.pending || status.inProgress) {
          const pending = Number(status.pending) || 0;
          message = pending
            ? `Syncing · ${pending.toLocaleString()} remaining`
            : "Syncing…";
        } else if (status.lastSuccess)
          message = `Up to date · ${new Date(status.lastSuccess).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        else message = "Connected";
      }
      e.syncSummary.textContent = message;
      if (!this.connected) this.clearConnectionCode();
      else if (this.linkExpiresAt && Date.now() >= this.linkExpiresAt) {
        this.clearConnectionCode();
        e.syncFeedback.textContent = "Code expired.";
      }
      if (this.loaded && status.lastAttempt !== this.lastAttempt)
        await this.onDataChanged();
      this.lastAttempt = status.lastAttempt;
      this.loaded = true;
    } catch (error) {
      e.syncSummary.textContent = `Sync status unavailable · ${error.message}`;
    }
  }

  async connectDevice(mode) {
    if (this.busy) return;
    const e = this.elements;
    const button = mode === "code" ? e.connectDeviceButton : e.startSyncButton;
    this.busy = true;
    e.syncFeedback.textContent = "";
    setButtonBusy(button, "Connecting…");
    this.updateButtons();
    try {
      const request =
        mode === "code"
          ? { connectionCode: e.connectionCode.value.trim() }
          : {
              configuration: {
                projectId: e.supabaseProjectId.value.trim(),
                publishableKey: e.supabaseApiKey.value.trim(),
              },
            };
      const response = await this.client.sendMessage({
        action: "supabase-connect",
        ...request,
      });
      if (!response?.success)
        throw new Error(response?.error || "Could not connect");
      e.connectionCode.value = "";
      e.supabaseApiKey.value = "";
      e.supabaseProjectId.value = "";
      e.projectSetup.open = false;
      e.syncFeedback.textContent = "";
      await this.updateProviderStatus();
      await this.onDataChanged();
    } catch (error) {
      e.syncFeedback.textContent = error.message;
    } finally {
      clearButtonBusy(button);
      this.busy = false;
      this.updateButtons();
      if (this.connected) e.createLinkButton.focus();
    }
  }

  clearConnectionCode() {
    this.linkExpiresAt = 0;
    this.elements.deviceLinkPanel.hidden = true;
    this.elements.generatedConnectionCode.value = "";
  }

  async createConnectionCode() {
    if (this.busy) return;
    const e = this.elements;
    this.busy = true;
    const startedAt = Date.now();
    this.clearConnectionCode();
    e.syncFeedback.textContent = "";
    setButtonBusy(e.createLinkButton, "Creating code…");
    this.updateButtons();
    try {
      const response = await this.client.sendMessage({
        action: "supabase-create-link",
      });
      if (!response?.success)
        throw new Error(response?.error || "Could not create connection code");
      this.linkExpiresAt = startedAt + 10 * 60_000;
      e.generatedConnectionCode.value = response.connectionCode;
      e.deviceLinkPanel.hidden = false;
      e.connectionCodeExpiry.textContent = `One device · valid until ${new Date(this.linkExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      await this.copyConnectionCode();
    } catch (error) {
      e.syncFeedback.textContent = error.message;
    } finally {
      clearButtonBusy(e.createLinkButton);
      this.busy = false;
      this.updateButtons();
    }
  }

  async copyConnectionCode() {
    const e = this.elements;
    if (!this.linkExpiresAt || Date.now() >= this.linkExpiresAt) {
      this.clearConnectionCode();
      e.syncFeedback.textContent = "Code expired.";
      return;
    }
    try {
      await navigator.clipboard.writeText(e.generatedConnectionCode.value);
      e.syncFeedback.textContent = "Code copied";
    } catch {
      e.generatedConnectionCode.focus();
      e.generatedConnectionCode.select();
      e.syncFeedback.textContent = "Copy the selected code manually.";
    }
  }

  async copySetupSql() {
    try {
      const migrations = [
        "20261101000000_durable_history_sync.sql",
        "20261101010000_watch_events.sql",
        "20261101020000_device_linking.sql",
        "20261101030000_import_reconciliation.sql",
        "20261101040000_playback_time_sync.sql",
        "20261101050000_anonymous_access_hardening.sql",
      ];
      const sql = await Promise.all(
        migrations.map(async (name) => {
          const response = await fetch(
            chrome.runtime.getURL(`supabase/migrations/${name}`),
          );
          if (!response.ok)
            throw new Error("Database setup SQL could not be loaded");
          return response.text();
        }),
      );
      await navigator.clipboard.writeText(sql.join("\n\n"));
      this.elements.syncFeedback.textContent =
        "SQL copied. Run in Supabase SQL Editor.";
    } catch (error) {
      this.elements.syncFeedback.textContent = error.message;
    }
  }
}

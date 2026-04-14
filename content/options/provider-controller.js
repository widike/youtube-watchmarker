// @ts-check

import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";

const STATUS_ICON_CLASSES = {
  secondary: "fas fa-info-circle",
  info: "fas fa-info-circle",
  success: "fas fa-check-circle",
  warning: "fas fa-exclamation-triangle",
  danger: "fas fa-times-circle",
};

export class ProviderController {
  constructor({ client, feedback, elements, onDataChanged }) {
    this.client = client;
    this.feedback = feedback;
    this.elements = elements;
    this.onDataChanged = onDataChanged;
  }

  bindEvents() {
    this.elements.providerIndexedDB.addEventListener("change", () => {
      void this.switchProvider("indexeddb");
    });

    this.elements.providerSupabase.addEventListener("change", () => {
      void this.switchProvider("supabase");
    });

    this.elements.enableAutoSync.addEventListener("change", (event) => {
      void this.toggleAutoSync(event.target.checked);
    });

    this.elements.saveSupabaseButton.addEventListener("click", () => {
      void this.saveSupabaseConfig();
    });

    this.elements.testSupabaseButton.addEventListener("click", () => {
      void this.testSupabaseConnection();
    });

    this.elements.clearSupabaseButton.addEventListener("click", () => {
      void this.clearSupabaseConfig();
    });

    this.elements.copySqlButton.addEventListener("click", () => {
      void this.copySqlToClipboard();
    });
  }

  async updateProviderStatus() {
    try {
      const [providerResponse, autoSyncResult] = await Promise.all([
        this.client.sendMessage({ action: "database-provider-status" }),
        chrome.storage.sync.get(["auto_sync_enabled"]),
      ]);

      const providerType = providerResponse?.status?.type || "indexeddb";
      this.elements.providerIndexedDB.checked = providerType === "indexeddb";
      this.elements.providerSupabase.checked = providerType === "supabase";
      this.elements.enableAutoSync.checked =
        autoSyncResult.auto_sync_enabled || false;
      this.elements.supabaseConfig.classList.toggle(
        "d-none",
        providerType !== "supabase",
      );

      if (providerType === "supabase") {
        await this.loadSupabaseConfig();
      }
    } catch (error) {
      this.feedback.error(`Failed to load provider status: ${error.message}`);
    }
  }

  async switchProvider(provider) {
    try {
      if (provider === "indexeddb") {
        this.elements.supabaseConfig.classList.add("d-none");
        this.hideSetupInstructions();
        await this.commitProviderChange("indexeddb");
        return;
      }

      this.elements.supabaseConfig.classList.remove("d-none");
      await this.loadSupabaseConfig();

      const status = await this.client.sendMessage({
        action: "supabase-get-status",
      });
      if (!status?.success || !status?.status?.configured) {
        this.updateSupabaseStatus(
          "secondary",
          "Enter your Supabase URL and Service Role key, then click Save or Test.",
        );
        this.showSetupInstructions();
        return;
      }

      this.updateSupabaseStatus("info", "Testing saved credentials...");
      const testResponse = await this.client.sendMessage({
        action: "supabase-test",
      });
      if (!testResponse?.success) {
        throw new Error(testResponse?.error || "Saved credentials failed");
      }

      await this.commitProviderChange("supabase");
      const tableExists = await this.checkTableExists();
      if (tableExists) {
        this.updateSupabaseStatus(
          "success",
          "Connected to Supabase. Table is ready.",
        );
        this.hideSetupInstructions();
      } else {
        this.updateSupabaseStatus(
          "warning",
          "Connected to Supabase, but the table setup is still required.",
        );
        this.showSetupInstructions();
      }
    } catch (error) {
      this.feedback.error(`Provider switch failed: ${error.message}`);
      this.elements.providerIndexedDB.checked = provider !== "indexeddb";
      this.elements.providerSupabase.checked = provider !== "supabase";
    }
  }

  async commitProviderChange(provider) {
    const response = await this.client.sendMessage({
      action: "database-provider-switch",
      provider,
    });

    if (!response?.success) {
      throw new Error(response?.error || "Provider switch failed");
    }

    this.feedback.success(
      `Switched to ${provider === "indexeddb" ? "Local Storage" : "Supabase"}`,
    );
    await this.onDataChanged();
  }

  async toggleAutoSync(isEnabled) {
    try {
      await chrome.storage.sync.set({ auto_sync_enabled: isEnabled });
      const response = await this.client.sendMessage({
        action: isEnabled ? "sync-manager-start" : "sync-manager-stop",
      });

      if (!response?.success) {
        throw new Error(response?.error || "Auto sync update failed");
      }

      this.feedback.success(
        `Automatic synchronization ${isEnabled ? "enabled" : "disabled"}`,
      );
    } catch (error) {
      this.elements.enableAutoSync.checked = !isEnabled;
      this.feedback.error(`Automatic synchronization failed: ${error.message}`);
    }
  }

  async saveSupabaseConfig() {
    try {
      const credentials = {
        supabaseUrl: this.elements.supabaseUrl.value.trim(),
        apiKey: this.elements.supabaseApiKey.value.trim(),
      };

      if (!credentials.supabaseUrl || !credentials.apiKey) {
        throw new Error("Supabase URL and API key are required");
      }

      setButtonBusy(this.elements.saveSupabaseButton, "Saving...");

      const response = await this.client.sendMessage({
        action: "supabase-configure",
        credentials,
      });

      if (!response?.success) {
        throw new Error(response?.error || "Configuration save failed");
      }

      this.elements.supabaseApiKey.value = "";
      this.feedback.success("Supabase configuration saved");
      await this.switchProvider("supabase");
    } catch (error) {
      this.feedback.error(`Supabase configuration failed: ${error.message}`);
    } finally {
      clearButtonBusy(this.elements.saveSupabaseButton);
    }
  }

  async testSupabaseConnection() {
    try {
      setButtonBusy(this.elements.testSupabaseButton, "Testing...");

      const response = await this.client.sendMessage({
        action: "supabase-test",
      });
      if (!response?.success) {
        throw new Error(response?.error || "Connection test failed");
      }

      const tableExists = await this.checkTableExists();
      if (tableExists) {
        this.updateSupabaseStatus(
          "success",
          "Connection successful. Table is ready.",
        );
        this.hideSetupInstructions();
      } else {
        this.updateSupabaseStatus(
          "warning",
          "Connection successful, but the table setup is still required.",
        );
        this.showSetupInstructions();
      }
    } catch (error) {
      this.updateSupabaseStatus(
        "danger",
        `Connection failed: ${error.message}`,
      );
    } finally {
      clearButtonBusy(this.elements.testSupabaseButton);
    }
  }

  async clearSupabaseConfig() {
    if (
      !confirm("Are you sure you want to clear the Supabase configuration?")
    ) {
      return;
    }

    try {
      const response = await this.client.sendMessage({
        action: "supabase-clear",
      });
      if (!response?.success) {
        throw new Error(response?.error || "Clear failed");
      }

      this.elements.supabaseUrl.value = "";
      this.elements.supabaseApiKey.value = "";
      this.elements.currentConfig.classList.add("d-none");
      this.hideSetupInstructions();
      await this.commitProviderChange("indexeddb");
      await this.updateProviderStatus();
    } catch (error) {
      this.feedback.error(
        `Failed to clear Supabase configuration: ${error.message}`,
      );
    }
  }

  async loadSupabaseConfig() {
    try {
      const response = await this.client.sendMessage({
        action: "supabase-get-credentials",
      });
      if (!response?.success || !response.credentials) {
        this.elements.currentConfig.classList.add("d-none");
        return;
      }

      this.elements.currentUrl.textContent =
        response.credentials.supabaseUrl || "-";
      this.elements.currentApiKey.textContent =
        response.credentials.apiKey || "-";
      this.elements.currentConfig.classList.remove("d-none");
    } catch (_error) {
      this.elements.currentConfig.classList.add("d-none");
    }
  }

  async copySqlToClipboard() {
    try {
      const sqlCode =
        document.getElementById("supabase-sql-code")?.textContent || "";
      await navigator.clipboard.writeText(sqlCode);
      this.feedback.success("SQL code copied to clipboard");
    } catch (_error) {
      this.feedback.error("Failed to copy SQL code");
    }
  }

  async checkTableExists() {
    const response = await this.client.sendMessage({
      action: "supabase-check-table",
    });
    return Boolean(response?.success && response.tableExists);
  }

  updateSupabaseStatus(level, text) {
    this.elements.supabaseStatus.className = `alert alert-${level} mt-3`;
    this.elements.supabaseStatusIcon.innerHTML = `<i class="${STATUS_ICON_CLASSES[level] || STATUS_ICON_CLASSES.info}"></i>`;
    this.elements.supabaseStatusText.textContent = text;
    this.elements.supabaseStatus.classList.remove("d-none");
  }

  showSetupInstructions() {
    this.elements.supabaseSetupInstructions.classList.remove("d-none");
  }

  hideSetupInstructions() {
    this.elements.supabaseSetupInstructions.classList.add("d-none");
  }
}

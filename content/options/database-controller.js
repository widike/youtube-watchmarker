// @ts-check

import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";

export class DatabaseController {
  constructor({ client, feedback, elements, onDataChanged }) {
    this.client = client;
    this.feedback = feedback;
    this.elements = elements;
    this.onDataChanged = onDataChanged;
  }

  bindEvents() {
    this.elements.exportButton.addEventListener("click", () => {
      void this.exportDatabase();
    });

    this.elements.importInput.addEventListener("change", (event) => {
      void this.importDatabase(event);
    });

    this.elements.resetButton.addEventListener("click", () => {
      void this.resetDatabase();
    });
  }

  async updateDatabaseSize() {
    try {
      const response = await this.client.sendMessage({
        action: "database-size",
      });
      this.elements.databaseSize.textContent = response?.success
        ? Number(response.size || 0).toLocaleString()
        : "N/A";
    } catch (_error) {
      this.elements.databaseSize.textContent = "Error";
    }
  }

  async exportDatabase() {
    try {
      const response = await this.client.sendMessage({
        action: "database-export",
      });
      if (!response?.success) {
        throw new Error(response?.error || "Export failed");
      }

      this.downloadDatabaseFile(response.data);
      this.feedback.success("Database exported successfully");
    } catch (error) {
      this.feedback.error(`Export failed: ${error.message}`);
    }
  }

  async importDatabase(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setButtonBusy(this.elements.importLabel, "Importing...");

      const content = await this.readFileAsText(file);
      const response = await this.client.sendMessage({
        action: "database-import",
        data: content,
      });

      if (!response?.success) {
        throw new Error(response?.error || "Import failed");
      }

      this.feedback.success(
        response.message || "Database imported successfully",
      );
      await this.onDataChanged();
    } catch (error) {
      this.feedback.error(`Import failed: ${error.message}`);
    } finally {
      clearButtonBusy(this.elements.importLabel);
      event.target.value = "";
    }
  }

  async resetDatabase() {
    if (
      !confirm(
        "Are you sure you want to reset the database? This action cannot be undone.",
      )
    ) {
      return;
    }

    try {
      const response = await this.client.sendMessage({
        action: "database-reset",
      });
      if (!response?.success) {
        throw new Error(response?.error || "Reset failed");
      }

      this.feedback.success("Database reset successfully");
      await this.onDataChanged();
    } catch (error) {
      this.feedback.error(`Reset failed: ${error.message}`);
    }
  }

  downloadDatabaseFile(data, suffix = "", extension = "json") {
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `youtube-watchmarker-${new Date().toISOString().slice(0, 10)}${suffix}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target?.result);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }
}

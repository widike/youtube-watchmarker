// @ts-check

import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";
import { fixUtf8DoubleEncoding } from "../../text-utils.js";

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

    this.elements.integrityButton.addEventListener("click", () => {
      void this.checkAndRepairIntegrity();
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

  downloadDatabaseFile(data, suffix = "", extension = "database") {
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

  summarizeIntegrityReport(report) {
    const totals = report.reports.reduce(
      (summary, provider) => ({
        duplicateGroups:
          summary.duplicateGroups + provider.duplicateIdGroups.length,
        duplicateRows: summary.duplicateRows + provider.duplicateRowCount,
        timestampClusters:
          summary.timestampClusters + provider.timestampClusters.length,
      }),
      { duplicateGroups: 0, duplicateRows: 0, timestampClusters: 0 },
    );

    return totals;
  }

  async checkAndRepairIntegrity() {
    try {
      setButtonBusy(this.elements.integrityButton, "Checking...");

      const checkResponse = await this.client.sendMessage({
        action: "database-integrity-check",
      });
      if (!checkResponse?.success) {
        throw new Error(checkResponse?.error || "Integrity check failed");
      }

      const summary = this.summarizeIntegrityReport(checkResponse.result);
      if (summary.duplicateRows === 0 && summary.timestampClusters === 0) {
        this.feedback.success("Database integrity check passed");
        return;
      }

      const backupResponse = await this.client.sendMessage({
        action: "database-integrity-backup",
      });
      if (!backupResponse?.success) {
        throw new Error(backupResponse?.error || "Backup export failed");
      }

      this.downloadDatabaseFile(backupResponse.data, "-before-repair", "json");

      const shouldRepair = confirm(
        `Found ${summary.duplicateRows} duplicate rows across ${summary.duplicateGroups} duplicate ID groups and ${summary.timestampClusters} suspicious timestamp clusters. A backup was downloaded. Repair now?`,
      );
      if (!shouldRepair) {
        this.feedback.success("Integrity check completed. Repair skipped.");
        return;
      }

      setButtonBusy(this.elements.integrityButton, "Repairing...");
      const repairResponse = await this.client.sendMessage({
        action: "database-integrity-repair",
      });
      if (!repairResponse?.success) {
        throw new Error(repairResponse?.error || "Integrity repair failed");
      }

      const repair = repairResponse.result;
      this.feedback.success(
        `Repair complete. Removed ${repair.local.duplicateRowsRemoved} duplicate rows and repaired ${repair.local.timestampsRepairedFromChromeHistory} timestamps from Chrome history.`,
      );
      await this.onDataChanged();
    } catch (error) {
      this.feedback.error(`Integrity repair failed: ${error.message}`);
    } finally {
      clearButtonBusy(this.elements.integrityButton);
    }
  }

  readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) =>
        resolve(fixUtf8DoubleEncoding(event.target?.result));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  }
}

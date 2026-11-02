// @ts-check

import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";
import { renderSyncStatus } from "./sync-status.js";

const SYNC_ACTIONS = {
  history: { action: "history-synchronize", label: "Browser history" },
  youtube: { action: "youtube-synchronize", label: "YouTube history" },
  likes: { action: "youtube-liked-videos", label: "YouTube likes" },
};

export class SyncController {
  constructor({
    client,
    feedback,
    elements,
    onDataChanged,
    refreshSearch,
    invalidateSources,
  }) {
    this.client = client;
    this.feedback = feedback;
    this.elements = elements;
    this.onDataChanged = onDataChanged;
    this.refreshSearch = refreshSearch;
    this.invalidateSources = invalidateSources;
  }

  bindEvents() {
    this.elements.syncDatabaseButton.addEventListener("click", () => {
      void this.syncProviders();
    });

    this.elements.syncHistoryButton.addEventListener("click", () => {
      void this.runSync("history", this.elements.syncHistoryButton);
    });

    this.elements.syncYouTubeButton.addEventListener("click", () => {
      void this.runSync("youtube", this.elements.syncYouTubeButton);
    });

    this.elements.syncLikesButton.addEventListener("click", () => {
      void this.runSync("likes", this.elements.syncLikesButton);
    });

    this.elements.syncAllButton.addEventListener("click", () => {
      void this.syncAll();
    });
  }

  getSyncStats(response) {
    const details = response?.response || {};
    const added = details.newCount ?? response?.videoCount ?? 0;
    const updated = details.updatedCount ?? 0;
    const skippedWithoutDate = details.unknownTimestampCount ?? 0;
    const unchanged = details.skippedCount ?? 0;

    return {
      added,
      updated,
      skippedWithoutDate,
      unchanged,
      changed: added + updated,
    };
  }

  formatSyncMessage(label, response) {
    const stats = this.getSyncStats(response);
    const parts = [`Added ${stats.added}`];

    if (stats.updated > 0) {
      parts.push(`updated ${stats.updated}`);
    }

    if (stats.skippedWithoutDate > 0) {
      parts.push(`${stats.skippedWithoutDate} undated skipped`);
    }

    if (stats.changed === 0 && stats.unchanged > 0) {
      parts.push(`${stats.unchanged} unchanged`);
    }

    return `${label} · ${parts.join(" · ")}`;
  }

  async syncProviders() {
    try {
      setButtonBusy(this.elements.syncDatabaseButton, "Syncing…");
      renderSyncStatus(this.elements.syncSummary, {
        configured: true,
        inProgress: true,
      });

      const response = await this.client.sendMessage({
        action: "sync-manager-sync-now",
      });

      if (!response?.success) {
        throw new Error(response?.error || "Sync failed");
      }

      renderSyncStatus(this.elements.syncSummary, {
        configured: true,
        inProgress: response.inProgress,
        lastSuccess: response.inProgress ? undefined : Date.now(),
      });
      await this.onDataChanged();
      await this.refreshSearch();
    } catch (error) {
      renderSyncStatus(this.elements.syncSummary, { error: error.message });
    } finally {
      clearButtonBusy(this.elements.syncDatabaseButton);
      this.invalidateSources();
    }
  }

  async runSync(type, button) {
    const config = SYNC_ACTIONS[type];

    try {
      setButtonBusy(button, "Syncing…");

      const response = await this.client.sendMessage({ action: config.action });
      if (!response?.success) {
        throw new Error(response?.error || `${config.label} sync failed`);
      }

      const stats = this.getSyncStats(response);
      this.feedback.success(this.formatSyncMessage(config.label, response));
      await this.onDataChanged();

      if (stats.changed > 0) {
        await this.refreshSearch();
      }
    } catch (error) {
      this.feedback.error(`${config.label} sync failed: ${error.message}`);
    } finally {
      clearButtonBusy(button);
      this.invalidateSources();
    }
  }

  async syncAll() {
    try {
      setButtonBusy(this.elements.syncAllButton, "Syncing…");

      const responses = await Promise.allSettled([
        this.client.sendMessage({ action: SYNC_ACTIONS.history.action }),
        this.client.sendMessage({ action: SYNC_ACTIONS.youtube.action }),
        this.client.sendMessage({ action: SYNC_ACTIONS.likes.action }),
      ]);

      const summary = responses.map((result, index) => {
        const label = Object.values(SYNC_ACTIONS)[index].label;
        if (result.status !== "fulfilled" || !result.value?.success) {
          return `${label}: failed`;
        }

        const stats = this.getSyncStats(result.value);
        return `${label}: ${stats.added} added, ${stats.updated} updated`;
      });

      const total = responses.reduce((sum, result) => {
        if (result.status !== "fulfilled" || !result.value?.success) {
          return sum;
        }

        return sum + this.getSyncStats(result.value).changed;
      }, 0);

      this.feedback.success(summary.join(" · "));
      await this.onDataChanged();

      if (total > 0) {
        await this.refreshSearch();
      }
    } catch (error) {
      this.feedback.error(`Sync all failed: ${error.message}`);
    } finally {
      clearButtonBusy(this.elements.syncAllButton);
      this.invalidateSources();
    }
  }
}

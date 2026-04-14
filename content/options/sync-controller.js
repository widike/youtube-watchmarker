// @ts-check

import { clearButtonBusy, setButtonBusy } from "../../ui/button-state.js";

const SYNC_ACTIONS = {
  history: { action: "history-synchronize", label: "Browser history" },
  youtube: { action: "youtube-synchronize", label: "YouTube history" },
  likes: { action: "youtube-liked-videos", label: "YouTube likes" },
};

export class SyncController {
  constructor({ client, feedback, elements, onDataChanged, refreshSearch }) {
    this.client = client;
    this.feedback = feedback;
    this.elements = elements;
    this.onDataChanged = onDataChanged;
    this.refreshSearch = refreshSearch;
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

  async syncProviders() {
    try {
      setButtonBusy(this.elements.syncDatabaseButton, "Syncing...");

      const providers = await this.client.sendMessage({
        action: "database-provider-list",
      });
      if (
        !providers?.success ||
        !providers.providers?.some(
          (provider) => provider.id === "supabase" && provider.isAvailable,
        )
      ) {
        throw new Error("Supabase is not configured");
      }

      const response = await this.client.sendMessage({
        action: "database-provider-sync",
        providers: ["indexeddb", "supabase"],
      });

      if (!response?.success) {
        throw new Error(response?.error || "Sync failed");
      }

      this.feedback.success(
        response.message || "Databases synchronized successfully",
      );
      await this.onDataChanged();
      await this.refreshSearch();
    } catch (error) {
      this.feedback.error(`Database sync failed: ${error.message}`);
    } finally {
      clearButtonBusy(this.elements.syncDatabaseButton);
    }
  }

  async runSync(type, button) {
    const config = SYNC_ACTIONS[type];

    try {
      setButtonBusy(button, "Syncing...");

      const response = await this.client.sendMessage({ action: config.action });
      if (!response?.success) {
        throw new Error(response?.error || `${config.label} sync failed`);
      }

      const count = response.videoCount || 0;
      this.feedback.success(
        `${config.label} synchronized. Added ${count} videos.`,
      );
      await this.onDataChanged();

      if (count > 0) {
        await this.refreshSearch();
      }
    } catch (error) {
      this.feedback.error(`${config.label} sync failed: ${error.message}`);
    } finally {
      clearButtonBusy(button);
    }
  }

  async syncAll() {
    try {
      setButtonBusy(this.elements.syncAllButton, "Syncing all...");

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

        return `${label}: ${result.value.videoCount || 0} videos`;
      });

      const total = responses.reduce((sum, result) => {
        if (result.status !== "fulfilled" || !result.value?.success) {
          return sum;
        }

        return sum + (result.value.videoCount || 0);
      }, 0);

      this.feedback.success(
        `All sources synchronized. Total added: ${total}. ${summary.join(" | ")}`,
      );
      await this.onDataChanged();

      if (total > 0) {
        await this.refreshSearch();
      }
    } catch (error) {
      this.feedback.error(`Sync all failed: ${error.message}`);
    } finally {
      clearButtonBusy(this.elements.syncAllButton);
    }
  }
}

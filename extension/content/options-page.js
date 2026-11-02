// @ts-check

import { LibraryController } from "./options/history-controller.js";
import { loadSettingsPanels } from "./options/panels.js";
import { initializeNavigation } from "./options/navigation.js";
import { runtimeClient } from "../ui/runtime-client.js";
import { ThemeController } from "../ui/theme-controller.js";
import { ToastService } from "../ui/toast-service.js";
import { createOptionsElements } from "./options/elements.js";
import { DatabaseController } from "./options/database-controller.js";
import { ProviderController } from "./options/provider-controller.js";
import { SettingsController } from "./options/settings-controller.js";
import { SyncController } from "./options/sync-controller.js";
import { SourcePreviewController } from "./options/source-preview-controller.js";
import { StatisticsController } from "../ui/statistics-controller.js";
import { DurationController } from "../ui/duration-controller.js";
import { ReconciliationController } from "./options/reconciliation-controller.js";

export class OptionsPage {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    await loadSettingsPanels();
    this.elements = createOptionsElements();
    this.feedback = new ToastService({
      errorToastElement: this.elements.errorToast,
      errorMessageElement: this.elements.errorToastMessage,
      statusElement: document.getElementById("operation-status"),
    });

    initializeNavigation();
    this.statisticsController = new StatisticsController({
      root: document.getElementById("panel-statistics"),
      client: runtimeClient,
      onWord: (word) => {
        this.elements.searchInput.value = word;
        location.hash = "history";
        void this.searchController.search({ wordGroup: word });
      },
    });

    this.themeController = new ThemeController({
      toggleButton: this.elements.themeToggle,
      iconElement: this.elements.themeIcon,
    });

    this.searchController = new LibraryController({
      client: runtimeClient,
      feedback: this.feedback,
      onDeleteSuccess: async () => this.databaseController.updateDatabaseSize(),
      queryInput: this.elements.searchInput,
      searchButton: this.elements.searchButton,
      searchIcon: this.elements.searchIcon,
      searchSpinner: this.elements.searchSpinner,
      resultsContainer: this.elements.searchResults,
    });

    this.databaseController = new DatabaseController({
      client: runtimeClient,
      feedback: this.feedback,
      elements: this.elements,
      onDataChanged: async () => {
        await this.databaseController.updateDatabaseSize();
        await this.searchController.search();
      },
    });

    this.providerController = new ProviderController({
      client: runtimeClient,
      feedback: this.feedback,
      elements: this.elements,
      onDataChanged: async () => this.databaseController.updateDatabaseSize(),
    });
    this.reconciliationController = new ReconciliationController({
      root: document.querySelector("[data-reconciliation]"),
      client: runtimeClient,
      onDataChanged: async () => {
        await this.databaseController.updateDatabaseSize();
        await this.searchController.search();
      },
    });
    this.reconciliationController.initialize();

    this.sourcePreviewController = new SourcePreviewController({
      client: runtimeClient,
    });
    this.syncController = new SyncController({
      client: runtimeClient,
      feedback: this.feedback,
      elements: this.elements,
      onDataChanged: async () => this.databaseController.updateDatabaseSize(),
      refreshSearch: async () => this.searchController.search(),
      invalidateSources: () => this.sourcePreviewController.invalidate(),
    });

    this.settingsController = new SettingsController({
      feedback: this.feedback,
    });

    this.durationController = new DurationController({
      root: document.getElementById("panel-sync"),
      client: runtimeClient,
    });

    this.bindKeyboardShortcuts();
    this.statisticsController.initialize();
    this.durationController.initialize();
    window.addEventListener(
      "pagehide",
      () => {
        this.statisticsController.dispose();
        this.durationController.dispose();
      },
      { once: true },
    );

    await this.themeController.initialize();
    await this.searchController.initialize();
    this.databaseController.bindEvents();
    this.providerController.bindEvents();
    this.syncController.bindEvents();
    this.sourcePreviewController.initialize();
    await this.settingsController.initialize();

    await Promise.all([
      this.databaseController.updateDatabaseSize(),
      this.providerController.updateProviderStatus(),
      this.searchController.loadInitialResults(),
    ]);

    this.initialized = true;
  }

  bindKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.getElementById("panel-history").hidden) {
          window.addEventListener(
            "hashchange",
            () => this.elements.searchInput.focus(),
            { once: true },
          );
          location.hash = "history";
        } else {
          this.elements.searchInput.focus();
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        void this.databaseController.exportDatabase();
      }
    });
  }
}

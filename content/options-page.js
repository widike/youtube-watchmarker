// @ts-check

import { HistorySearchController } from "../ui/history-search-controller.js";
import { runtimeClient } from "../ui/runtime-client.js";
import { ThemeController } from "../ui/theme-controller.js";
import { ToastService } from "../ui/toast-service.js";
import { createOptionsElements } from "./options/elements.js";
import { DatabaseController } from "./options/database-controller.js";
import { ProviderController } from "./options/provider-controller.js";
import { SettingsController } from "./options/settings-controller.js";
import { SyncController } from "./options/sync-controller.js";

function waitForBootstrap() {
  return new Promise((resolve) => {
    const poll = () => {
      if (window.bootstrap) {
        resolve(window.bootstrap);
        return;
      }

      setTimeout(poll, 50);
    };

    poll();
  });
}

export class OptionsPage {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    const bootstrap = await waitForBootstrap();
    this.elements = createOptionsElements();
    this.feedback = new ToastService({
      bootstrap,
      successToastElement: this.elements.successToast,
      errorToastElement: this.elements.errorToast,
      successMessageElement: this.elements.successToastMessage,
      errorMessageElement: this.elements.errorToastMessage,
      announcerElement: this.elements.screenReaderAnnouncements,
    });

    this.themeController = new ThemeController({
      toggleButton: this.elements.themeToggle,
      iconElement: this.elements.themeIcon,
    });

    this.searchController = new HistorySearchController({
      client: runtimeClient,
      feedback: this.feedback,
      queryInput: this.elements.searchInput,
      searchButton: this.elements.searchButton,
      searchIcon: this.elements.searchIcon,
      searchSpinner: this.elements.searchSpinner,
      resultsContainer: this.elements.searchResults,
      emptyMessages: {
        default:
          "No videos found in your watch history. Try synchronizing a source first.",
        search: "No videos found matching your search.",
      },
      onDeleteSuccess: async () => this.databaseController.updateDatabaseSize(),
    });

    this.databaseController = new DatabaseController({
      client: runtimeClient,
      feedback: this.feedback,
      elements: this.elements,
      onDataChanged: async () => {
        await this.databaseController.updateDatabaseSize();
        await this.searchController.search({ silent: true });
      },
    });

    this.providerController = new ProviderController({
      client: runtimeClient,
      feedback: this.feedback,
      elements: this.elements,
      onDataChanged: async () => this.databaseController.updateDatabaseSize(),
    });

    this.syncController = new SyncController({
      client: runtimeClient,
      feedback: this.feedback,
      elements: this.elements,
      onDataChanged: async () => this.databaseController.updateDatabaseSize(),
      refreshSearch: async () => this.searchController.search({ silent: true }),
    });

    this.settingsController = new SettingsController({
      feedback: this.feedback,
    });

    this.bindKeyboardShortcuts();
    this.addAnimations();

    await this.themeController.initialize();
    this.searchController.initialize();
    this.databaseController.bindEvents();
    this.providerController.bindEvents();
    this.syncController.bindEvents();
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
        this.elements.searchInput.focus();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        void this.databaseController.exportDatabase();
      }
    });
  }

  addAnimations() {
    document.querySelectorAll(".card").forEach((card, index) => {
      card.style.animationDelay = `${index * 0.08}s`;
      card.classList.add("animate-slide-in-up");
    });
  }
}

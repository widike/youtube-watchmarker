import { HistorySearchController } from "./ui/history-search-controller.js";
import { runtimeClient } from "./ui/runtime-client.js";
import { ThemeController } from "./ui/theme-controller.js";
import { ToastService } from "./ui/toast-service.js";

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

class PopupPage {
  async initialize() {
    const bootstrap = await waitForBootstrap();

    const themeController = new ThemeController({
      toggleButton: document.getElementById("theme-toggle"),
      iconElement: document.getElementById("theme-icon"),
    });

    const feedback = new ToastService({
      bootstrap,
      successToastElement: document.getElementById("successToast"),
      errorToastElement: document.getElementById("errorToast"),
      successMessageElement: document.getElementById("successToastMessage"),
      errorMessageElement: document.getElementById("errorToastMessage"),
    });

    const searchController = new HistorySearchController({
      client: runtimeClient,
      feedback,
      queryInput: document.getElementById("idSearch_Query"),
      searchButton: document.getElementById("idSearch_Lookup"),
      searchIcon: document.getElementById("search-icon"),
      searchSpinner: document.getElementById("search-spinner"),
      resultsContainer: document.getElementById("idSearch_Results"),
      initialLoadingElement: document.getElementById("initial-loading"),
      pageSize: 30,
      compact: true,
      emptyMessages: {
        default: "No videos found in your watch history.",
        search: "No videos found matching your search.",
      },
    });

    await themeController.initialize();
    searchController.initialize();
    await searchController.loadInitialResults();

    document
      .getElementById("open-options")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        void runtimeClient.openOptionsPage();
      });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("idSearch_Query")?.focus();
      }

      if (event.key === "Escape") {
        window.close();
      }
    });
  }
}

const page = new PopupPage();

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      void page.initialize();
    },
    { once: true },
  );
} else {
  void page.initialize();
}

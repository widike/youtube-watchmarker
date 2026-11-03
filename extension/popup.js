import { HistorySearchController } from "./ui/history-search-controller.js";
import { HistoryVirtualList } from "./ui/history-virtual-list.js";
import { runtimeClient } from "./ui/runtime-client.js";
import { ThemeController } from "./ui/theme-controller.js";
import { StatisticsController } from "./ui/statistics-controller.js";

class PopupPage {
  async initialize() {
    this.results = document.getElementById("idSearch_Results");
    this.query = document.getElementById("idSearch_Query");
    this.library = new HistoryVirtualList(this.results, { root: this.results });
    this.feedback = {
      error: (message) => {
        const status = document.getElementById("popup-feedback");
        status.textContent = message;
        status.hidden = false;
      },
    };
    this.search = new HistorySearchController({
      client: runtimeClient,
      feedback: { error: () => {} },
      queryInput: this.query,
      searchButton: document.getElementById("idSearch_Lookup"),
      searchIcon: document.getElementById("search-icon"),
      searchSpinner: document.getElementById("search-spinner"),
      resultsContainer: this.results,
      batchSize: 30,
      renderResults: (args) => this.render(args),
    });
    this.search.state.period = "all";
    this.bindEvents();
    this.statistics = new StatisticsController({
      root: document.getElementById("popup-statistics"),
      client: runtimeClient,
      compact: true,
    });
    const theme = new ThemeController({
      toggleButton: document.getElementById("theme-toggle"),
      iconElement: document.getElementById("theme-icon"),
    });
    const themeReady = theme.initialize();
    this.search.initialize();
    await this.search.loadInitialResults();
    this.statistics.initialize();
    await themeReady;
  }

  render(args) {
    this.library.update({
      ...args,
      view: "list",
      sort: "newest",
      onReset: () => {
        if (this.search.state.currentQuery) this.clearSearch();
        else void this.openPage("sync");
      },
    });
    const { totalResults } = args.state;
    document.getElementById("result-count").textContent =
      `${totalResults.toLocaleString()} ${totalResults === 1 ? "entry" : "entries"}`;
    document.getElementById("clear-search").hidden = !this.query.value;
    document.getElementById("search-status").textContent =
      `${totalResults.toLocaleString()} history entries found. ${args.results.length.toLocaleString()} loaded.`;
    document.getElementById("popup-feedback").hidden = true;
  }

  bindEvents() {
    document
      .getElementById("open-statistics")
      .addEventListener("click", (event) => {
        event.preventDefault();
        void this.openPage("statistics");
      });
    document
      .getElementById("open-options")
      .addEventListener("click", (event) => {
        event.preventDefault();
        void this.openPage();
      });
    document
      .getElementById("open-preferences")
      .addEventListener("click", (event) => {
        event.preventDefault();
        void this.openPage("preferences");
      });
    document
      .getElementById("clear-search")
      .addEventListener("click", () => this.clearSearch());
    this.query.addEventListener("input", () => {
      document.getElementById("clear-search").hidden = !this.query.value;
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.query.focus();
        this.query.select();
      }
      if (event.key === "Escape") window.close();
    });
    window.addEventListener(
      "pagehide",
      () => {
        this.search.dispose();
        this.library.dispose();
        this.statistics?.dispose();
      },
      { once: true },
    );
  }

  clearSearch() {
    this.query.value = "";
    this.query.focus();
    void this.search.search();
  }

  async openPage(section = "history") {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`content/index.html#${section}`),
      });
      window.close();
    } catch {
      this.feedback.error("Could not open watch history.");
    }
  }
}

const page = new PopupPage();
const initialize = () =>
  void page.initialize().catch(() => {
    const results = document.getElementById("idSearch_Results");
    results.setAttribute("aria-busy", "false");
    results.innerHTML =
      '<div class="history-empty" role="alert"><p>Could not load history. Reopen the popup to retry.</p></div>';
  });
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", initialize, { once: true });
else initialize();

import { HistorySearchController } from "../../ui/history-search-controller.js";
import { HistoryVirtualList } from "../../ui/history-virtual-list.js";

const STORAGE_KEY = "historyDisplay";

export class LibraryController extends HistorySearchController {
  constructor(options) {
    super(options);
    this.display = { view: "grid" };
    this.library = new HistoryVirtualList(this.resultsContainer);
    this.state.period = "all";
    this.sort = "newest";
    this.getSearchOptions = () => ({
      period: this.state.period,
      sort: this.sort,
    });
    this.renderResults = (args) => {
      this.lastRender = args;
      this.library.update({
        ...args,
        ...this.display,
        sort: this.sort,
        onReset: () => this.reset(),
      });
      this.updateSummary();
    };
  }

  async initialize() {
    super.initialize();
    this.onMetadataRefresh = () => {
      if (!document.hidden && !document.getElementById("panel-history").hidden)
        void this.refreshMetadata();
    };
    this.onDurationChange = (changes, area) => {
      const change = changes.youtube_duration_state;
      if (
        area === "local" &&
        change?.newValue?.cacheRevision !== change?.oldValue?.cacheRevision
      )
        this.onMetadataRefresh();
    };
    chrome.storage.onChanged.addListener(this.onDurationChange);
    window.addEventListener("focus", this.onMetadataRefresh);
    window.addEventListener("hashchange", this.onMetadataRefresh);
    document.addEventListener("visibilitychange", this.onMetadataRefresh);
    window.addEventListener(
      "pagehide",
      () => {
        this.dispose();
        this.library.dispose();
      },
      { once: true },
    );
    try {
      const saved = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      this.display = {
        view: saved?.view === "list" ? "list" : "grid",
      };
    } catch {
      /* Use the defaults when storage is unavailable. */
    }
    const period = document.getElementById("history-period");
    period.addEventListener("change", () => {
      this.state.period = period.value;
      void this.search();
    });
    document
      .getElementById("history-sort")
      .addEventListener("change", (event) => {
        this.sort = event.target.value;
        void this.search();
      });
    document.querySelectorAll("[data-history-view]").forEach((button) =>
      button.addEventListener("click", () => {
        this.display.view = button.dataset.historyView;
        this.updateViewButtons();
        this.saveDisplay();
        if (this.lastRender)
          this.renderResults({ ...this.lastRender, reset: false });
      }),
    );
    document.getElementById("clear-search").addEventListener("click", () => {
      this.queryInput.value = "";
      this.queryInput.focus();
      void this.search();
    });
    this.updateViewButtons();
  }

  saveDisplay() {
    void chrome.storage.local
      .set({ [STORAGE_KEY]: this.display })
      .catch(() =>
        this.feedback.error("Could not save your display preference."),
      );
  }

  dispose() {
    super.dispose();
    chrome.storage.onChanged.removeListener(this.onDurationChange);
    window.removeEventListener("focus", this.onMetadataRefresh);
    window.removeEventListener("hashchange", this.onMetadataRefresh);
    document.removeEventListener("visibilitychange", this.onMetadataRefresh);
  }

  updateViewButtons() {
    document
      .querySelectorAll("[data-history-view]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.historyView === this.display.view),
        ),
      );
  }

  updateSummary() {
    const { totalResults } = this.state;
    const count = totalResults.toLocaleString();
    document.getElementById("history-result-count").textContent =
      `${count} ${totalResults === 1 ? "entry" : "entries"}`;
    document.getElementById("history-search-status").textContent =
      `${count} history entries found.`;
    document.getElementById("clear-search").hidden = !this.queryInput.value;
  }

  reset() {
    if (!this.state.currentQuery && this.state.period === "all") {
      location.hash = "sync";
      return;
    }
    this.queryInput.value = "";
    this.state.period = "all";
    document.getElementById("history-period").value = "all";
    void this.search();
  }
}

import { dashboard, periodControls } from "./statistics-dashboard.js";
import { bindHeatmaps } from "./statistics-heatmaps.js";
import { popupStatistics } from "./popup-statistics.js";
import { PERIODS } from "../statistics/statistics-dates.js";

export class StatisticsController {
  constructor({ root, client, compact = false, onWord = () => {} }) {
    this.root = root;
    this.client = client;
    this.compact = compact;
    this.onWord = onWord;
    this.period = "month";
    this.generation = 0;
  }

  initialize() {
    if (this.compact) {
      void this.load();
      return;
    }
    this.onDurationChange = (changes, area) => {
      const change = changes.youtube_duration_state;
      if (
        area === "local" &&
        change?.newValue?.cacheRevision !== change?.oldValue?.cacheRevision &&
        !this.root.hidden &&
        !document.hidden
      )
        void this.load();
    };
    chrome.storage.onChanged.addListener(this.onDurationChange);
    this.root.querySelector("[data-stats-periods]").innerHTML =
      periodControls();
    this.onClick = (event) => {
      const period = event.target.closest("[data-stats-period]");
      if (period) {
        this.period = period.dataset.statsPeriod;
        void this.load();
      }
      if (event.target.closest("[data-stats-refresh]")) {
        void this.load();
      }
      const word = event.target.closest("[data-stats-word]");
      if (word) this.onWord(word.dataset.statsWord);
    };
    this.root.addEventListener("click", this.onClick);
    this.onShow = () => {
      if (!this.root.hidden && !document.hidden) {
        void this.load();
      }
    };
    window.addEventListener("hashchange", this.onShow);
    window.addEventListener("focus", this.onShow);
    document.addEventListener("visibilitychange", this.onShow);
    this.onShow();
  }

  async load() {
    const generation = ++this.generation;
    const period = this.period;
    const content = this.compact
      ? this.root
      : this.root.querySelector("[data-stats-content]");
    const status = this.root.querySelector("[data-stats-status]");
    this.root.setAttribute("aria-busy", "true");
    if (status) status.textContent = this.stats ? "Updating…" : "";
    this.root
      .querySelectorAll("[data-stats-period]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.statsPeriod === this.period),
        ),
      );
    try {
      const response = await this.client.sendMessage({
        action: "history-statistics",
        period,
      });
      if (generation !== this.generation) return;
      if (!response?.success || response.statistics?.period !== period)
        throw new Error("Statistics unavailable");
      const stats = response.statistics;
      if (this.compact) {
        content.innerHTML = popupStatistics(stats);
        this.stats = stats;
        return;
      }
      content.innerHTML = dashboard(stats);
      bindHeatmaps(content);
      this.stats = stats;
      if (status) status.textContent = "";
    } catch {
      if (generation !== this.generation) return;
      if (this.compact) content.textContent = "Statistics unavailable";
      else {
        this.root
          .querySelectorAll("[data-stats-period]")
          .forEach((button) =>
            button.setAttribute(
              "aria-pressed",
              String(button.dataset.statsPeriod === this.stats?.period),
            ),
          );
        status.textContent = `Could not update statistics${this.stats ? ` · showing ${PERIODS[this.stats.period].label.toLowerCase()}` : ""}`;
        if (!this.stats)
          content.innerHTML =
            '<div class="stats-empty"><p>Statistics could not be loaded.</p></div>';
      }
    } finally {
      if (generation === this.generation)
        this.root.setAttribute("aria-busy", "false");
    }
  }

  dispose() {
    if (this.onDurationChange)
      chrome.storage.onChanged.removeListener(this.onDurationChange);
    this.generation++;
    this.root.removeEventListener("click", this.onClick);
    window.removeEventListener("hashchange", this.onShow);
    window.removeEventListener("focus", this.onShow);
    document.removeEventListener("visibilitychange", this.onShow);
  }
}

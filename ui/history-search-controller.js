// @ts-check

import { clearButtonBusy, setButtonBusy } from "./button-state.js";
import { renderWatchHistoryTable } from "./watch-history-table.js";

export class HistorySearchController {
  constructor({
    client,
    feedback,
    queryInput,
    searchButton,
    searchIcon,
    searchSpinner,
    resultsContainer,
    initialLoadingElement = null,
    pageSize = 50,
    compact = false,
    emptyMessages,
    onDeleteSuccess = async () => {},
    onSearchSuccess = async () => {},
  }) {
    this.client = client;
    this.feedback = feedback;
    this.queryInput = queryInput;
    this.searchButton = searchButton;
    this.searchIcon = searchIcon;
    this.searchSpinner = searchSpinner;
    this.resultsContainer = resultsContainer;
    this.initialLoadingElement = initialLoadingElement;
    this.compact = compact;
    this.emptyMessages = emptyMessages;
    this.onDeleteSuccess = onDeleteSuccess;
    this.onSearchSuccess = onSearchSuccess;
    this.state = {
      currentQuery: "",
      currentPage: 1,
      pageSize,
      totalResults: 0,
      isSearching: false,
    };
  }

  initialize() {
    this.searchButton?.addEventListener("click", () => {
      void this.search();
    });

    this.queryInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.search();
      }
    });

    let timeoutId;
    this.queryInput?.addEventListener("input", () => {
      clearTimeout(timeoutId);

      timeoutId = setTimeout(() => {
        this.state.currentPage = 1;
        this.state.currentQuery = this.queryInput.value.trim();
        void this.search();
      }, 300);
    });
  }

  async loadInitialResults() {
    this.state.currentQuery = "";
    this.state.currentPage = 1;
    await this.search({ silent: true });
  }

  async search({ silent = false } = {}) {
    if (this.state.isSearching) {
      return;
    }

    this.state.currentQuery =
      this.queryInput?.value.trim() || this.state.currentQuery;
    this.state.isSearching = true;
    this.setSearchingState(true);

    try {
      const response = await this.client.sendMessage({
        action: "search-videos",
        query: this.state.currentQuery,
        page: this.state.currentPage,
        pageSize: this.state.pageSize,
      });

      if (!response?.success) {
        throw new Error(response?.error || "Search failed");
      }

      const results = response.objVideos || response.results || [];
      this.state.totalResults = response.totalResults || 0;

      this.hideInitialLoading();
      renderWatchHistoryTable({
        container: this.resultsContainer,
        results,
        state: this.state,
        compact: this.compact,
        emptyMessages: this.emptyMessages,
        onDelete: (videoId, button) => this.deleteVideo(videoId, button),
        onPageChange: (page) => {
          this.state.currentPage = page;
          void this.search();
        },
      });

      await this.onSearchSuccess(results);
    } catch (_error) {
      this.hideInitialLoading();

      if (!silent) {
        this.feedback.error(
          this.state.currentQuery
            ? "Search failed. Please try again."
            : "Failed to load watch history.",
        );
      }

      this.resultsContainer.innerHTML = `
                <div class="alert alert-${silent ? "info" : "danger"} ${this.compact ? "m-3" : ""}">
                    <i class="fas fa-${silent ? "info-circle" : "exclamation-circle"} me-2"></i>
                    ${silent ? this.emptyMessages.default : "An error occurred. Please try again."}
                </div>
            `;
    } finally {
      this.setSearchingState(false);
      this.state.isSearching = false;
    }
  }

  async deleteVideo(videoId, button) {
    if (
      !confirm(
        "Are you sure you want to delete this video from your watch history?",
      )
    ) {
      return;
    }

    try {
      setButtonBusy(button, "Deleting...");

      const response = await this.client.sendMessage({
        action: "search-delete",
        videoId,
      });

      if (!response?.success) {
        throw new Error(response?.error || "Delete failed");
      }

      this.feedback.success("Video deleted successfully");

      const totalPagesAfterDelete = Math.ceil(
        (this.state.totalResults - 1) / this.state.pageSize,
      );
      if (
        this.state.currentPage > totalPagesAfterDelete &&
        totalPagesAfterDelete > 0
      ) {
        this.state.currentPage = totalPagesAfterDelete;
      }

      await this.onDeleteSuccess();
      await this.search();
    } catch (error) {
      this.feedback.error(`Delete failed: ${error.message}`);
      clearButtonBusy(button);
    }
  }

  setSearchingState(isSearching) {
    this.searchIcon?.classList.toggle("d-none", isSearching);
    this.searchSpinner?.classList.toggle("d-none", !isSearching);

    if (this.searchButton) {
      this.searchButton.disabled = isSearching;
    }

    if (this.resultsContainer) {
      this.resultsContainer.classList.toggle("search-loading", isSearching);
    }
  }

  hideInitialLoading() {
    if (this.initialLoadingElement) {
      this.initialLoadingElement.style.display = "none";
    }
  }
}

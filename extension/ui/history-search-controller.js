// Requests stay bounded; the UI accumulates records as the reader scrolls.
export class HistorySearchController {
  constructor({
    client,
    feedback,
    queryInput,
    searchButton,
    searchIcon,
    searchSpinner,
    resultsContainer,
    batchSize = 50,
    onSearchSuccess = async () => {},
    onDeleteSuccess = async () => {},
    renderResults,
    getSearchOptions = () => ({}),
  }) {
    Object.assign(this, {
      client,
      feedback,
      queryInput,
      searchButton,
      searchIcon,
      searchSpinner,
      resultsContainer,
      onSearchSuccess,
      onDeleteSuccess,
      renderResults,
      getSearchOptions,
      batchSize,
    });
    this.requestId = 0;
    this.results = [];
    this.nextOffset = 0;
    this.state = {
      currentQuery: "",
      period: "all",
      totalResults: 0,
      isSearching: false,
      isLoadingMore: false,
      hasMore: false,
      loadError: "",
    };
  }

  initialize() {
    this.searchButton?.addEventListener("click", () => void this.search());
    this.queryInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.search();
      }
    });
    this.queryInput?.addEventListener("input", () => {
      clearTimeout(this.debounceTimer);
      // Invalidate immediately, before the debounce, so old batches cannot
      // appear under a newly typed query or trigger another stale request.
      ++this.requestId;
      this.state.wordGroup = "";
      this.state.hasMore = false;
      this.debounceTimer = setTimeout(() => void this.search(), 300);
    });
  }

  async loadInitialResults() {
    await this.search();
  }

  async search({ wordGroup } = {}) {
    if (this.disposed) return;
    clearTimeout(this.debounceTimer);
    ++this.requestId;
    this.results = [];
    this.nextOffset = 0;
    const query = this.queryInput?.value.trim() || "";
    this.state.wordGroup =
      wordGroup ??
      (query === this.state.currentQuery ? this.state.wordGroup : "");
    this.state.currentQuery = query;
    this.state.totalResults = 0;
    this.state.hasMore = false;
    this.state.loadError = "";
    await this.fetchBatch({ reset: true });
  }

  async loadMore() {
    if (
      this.disposed ||
      this.deleting ||
      this.state.isSearching ||
      this.state.isLoadingMore ||
      !this.state.hasMore ||
      this.state.loadError
    )
      return;
    await this.fetchBatch();
  }

  async retry() {
    if (this.disposed || this.state.isSearching || this.state.isLoadingMore)
      return;
    this.state.loadError = "";
    await this.fetchBatch({ reset: this.results.length === 0 });
  }

  async refreshMetadata({ replace = false } = {}) {
    if (this.disposed) return;
    if (
      this.deleting ||
      this.state.isSearching ||
      this.state.isLoadingMore ||
      this.metadataRefreshing
    ) {
      this.metadataRefreshPending = true;
      this.historyRefreshPending ||= replace;
      return;
    }
    this.metadataRefreshPending = false;
    this.metadataRefreshing = true;
    replace ||= this.historyRefreshPending;
    this.historyRefreshPending = false;
    const requestId = this.requestId;
    const metadataId = (this.metadataId = (this.metadataId || 0) + 1);
    const updated = new Map();
    let totalResults = this.state.totalResults;
    const limit = replace
      ? Math.max(this.nextOffset, this.batchSize)
      : this.nextOffset;
    try {
      for (let offset = 0; offset < limit; offset += 100) {
        const response = await this.client.sendMessage({
          action: "search-videos",
          query: this.state.currentQuery,
          ...(this.state.wordGroup ? { wordGroup: this.state.wordGroup } : {}),
          offset,
          limit: Math.min(100, limit - offset),
          ...this.getSearchOptions(),
        });
        if (this.disposed || metadataId !== this.metadataId) return;
        if (requestId !== this.requestId) {
          void this.refreshMetadata({ replace });
          return;
        }
        if (!response?.success) return;
        totalResults = response.totalResults || 0;
        for (const video of response.objVideos || [])
          updated.set(video.entryId || video.strIdent, video);
        if (offset + (response.objVideos || []).length >= totalResults) break;
      }
      if (replace) {
        this.results = [...updated.values()];
        this.nextOffset = this.results.length;
        this.state.totalResults = totalResults;
        this.state.hasMore = this.nextOffset < totalResults;
      } else
        this.results = this.results.map(
          (video) => updated.get(video.entryId || video.strIdent) || video,
        );
      // Keep loaded pages, pagination and the virtual list's scroll position.
      this.render();
    } catch {
      // Existing cards remain usable; the next metadata change/focus retries.
    } finally {
      this.metadataRefreshing = false;
      if (
        this.metadataRefreshPending &&
        !this.disposed &&
        !this.deleting &&
        !this.state.isSearching &&
        !this.state.isLoadingMore
      )
        void this.refreshMetadata();
    }
  }

  async fetchBatch({ reset = false } = {}) {
    const requestId = ++this.requestId;
    const offset = this.nextOffset;
    this.state.isSearching = reset;
    this.state.isLoadingMore = !reset;
    this.setSearchingState();
    this.render({ reset });
    try {
      const response = await this.client.sendMessage({
        action: "search-videos",
        query: this.state.currentQuery,
        ...(this.state.wordGroup ? { wordGroup: this.state.wordGroup } : {}),
        offset,
        limit: this.batchSize,
        ...this.getSearchOptions(),
      });
      if (requestId !== this.requestId) return;
      if (!response?.success)
        throw new Error(response?.error || "Search failed");
      const batch = response.objVideos || [];
      const records = new Map(
        this.results.map((video) => [video.entryId || video.strIdent, video]),
      );
      for (const video of batch)
        records.set(video.entryId || video.strIdent, video);
      this.results = [...records.values()];
      this.nextOffset = offset + batch.length;
      this.state.totalResults = response.totalResults || 0;
      this.state.hasMore =
        batch.length > 0 && this.nextOffset < this.state.totalResults;
      await this.onSearchSuccess(batch);
    } catch (_error) {
      if (requestId !== this.requestId) return;
      this.state.loadError = reset
        ? "Could not load history."
        : "Could not load more videos.";
    } finally {
      if (requestId === this.requestId) {
        this.state.isSearching = false;
        this.state.isLoadingMore = false;
        this.setSearchingState();
        this.render();
        if (this.metadataRefreshPending) void this.refreshMetadata();
      }
    }
  }

  render({ reset = false } = {}) {
    if (this.disposed) return;
    this.renderResults({
      container: this.resultsContainer,
      results: this.results,
      state: this.state,
      reset,
      onDelete: (id, button) => this.deleteVideo(id, button),
      onLoadMore: () => void this.loadMore(),
      onRetry: () => void this.retry(),
    });
  }

  async deleteVideo(videoId, button) {
    if (this.disposed || this.deleting) return;
    if (
      !confirm(
        "Delete all watches of this video from local history, Supabase on all devices, and the signed-in YouTube account's history?",
      )
    )
      return;
    button.disabled = true;
    this.deleting = true;
    // Ignore a batch captured before deletion shifts the server-side offset.
    ++this.requestId;
    this.state.isSearching = this.state.isLoadingMore = false;
    try {
      const response = await this.client.sendMessage({
        action: "search-delete",
        videoId,
      });
      if (!response?.success && !response?.deleted)
        throw new Error(response?.error || "Deletion failed");
      const before = this.results.length;
      this.results = this.results.filter((video) => video.strIdent !== videoId);
      const removed = before - this.results.length;
      this.nextOffset = Math.max(0, this.nextOffset - removed);
      this.state.totalResults = Math.max(0, this.state.totalResults - removed);
      this.state.hasMore = this.nextOffset < this.state.totalResults;
      await this.onDeleteSuccess();
      if (!response.success) this.feedback.error(response.error);
    } catch (error) {
      button.disabled = false;
      this.feedback.error(`Could not delete video: ${error.message}`);
    } finally {
      this.deleting = false;
      this.setSearchingState();
      this.render();
      if (this.metadataRefreshPending) void this.refreshMetadata();
    }
  }

  dispose() {
    this.disposed = true;
    ++this.requestId;
    clearTimeout(this.debounceTimer);
  }

  setSearchingState() {
    const { isSearching, isLoadingMore } = this.state;
    if (this.searchIcon) this.searchIcon.hidden = isSearching;
    if (this.searchSpinner) this.searchSpinner.hidden = !isSearching;
    if (this.searchButton) this.searchButton.disabled = isSearching;
    this.resultsContainer?.classList.toggle("search-loading", isSearching);
    this.resultsContainer?.setAttribute(
      "aria-busy",
      String(isSearching || isLoadingMore),
    );
  }
}

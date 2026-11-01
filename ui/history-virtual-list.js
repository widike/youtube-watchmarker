import {
  Virtualizer,
  defaultRangeExtractor,
  observeElementRect,
  observeElementOffset,
  elementScroll,
  observeWindowRect,
  observeWindowOffset,
  windowScroll,
} from "../vendor/tanstack-virtual.js";
import {
  historyRows,
  videoCard,
  escapeHtml,
  emptyHistoryMarkup,
} from "./history-library.js";
import { observeThumbnails } from "./history-thumbnails.js";

// The same adapter supports the popup's scroll region and the library window.
export class HistoryVirtualList {
  constructor(container, { root = null } = {}) {
    this.container = container;
    this.root = root;
    this.rows = [];
    this.nodes = new Map();
    container.innerHTML =
      '<div class="history-empty-state"></div><div class="history-virtual-canvas"></div><div class="history-load-state" role="status" aria-live="polite"></div>';
    this.empty = container.querySelector(".history-empty-state");
    this.canvas = container.querySelector(".history-virtual-canvas");
    this.footer = container.querySelector(".history-load-state");
    this.onClick = (event) => {
      const button = event.target.closest("button");
      if (button?.hasAttribute("data-video-delete"))
        this.args.onDelete(button.dataset.videoDelete, button);
      if (button?.hasAttribute("data-empty-action")) this.args.onReset();
      if (button?.hasAttribute("data-history-retry")) this.args.onRetry();
    };
    container.addEventListener("click", this.onClick);
    this.createVirtualizer();
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(container);
    this.intersection = new IntersectionObserver(() => this.checkLoadMore(), {
      root,
      rootMargin: "320px 0px",
    });
    this.intersection.observe(this.footer);
  }

  createVirtualizer() {
    this.virtualizer = new Virtualizer({
      count: 0,
      getScrollElement: () => this.root || window,
      estimateSize: (index) => this.estimateSize(index),
      scrollToFn: this.root ? elementScroll : windowScroll,
      observeElementRect: this.root ? observeElementRect : observeWindowRect,
      observeElementOffset: this.root
        ? observeElementOffset
        : observeWindowOffset,
      overscan: 5,
      onChange: () => this.schedule(),
      rangeExtractor: (range) => {
        const indexes = defaultRangeExtractor(range);
        const focused = document.activeElement?.closest(".history-virtual-row");
        if (focused && this.canvas.contains(focused)) {
          const index = this.rows.findIndex(
            (row) => row.key === focused.dataset.key,
          );
          if (index >= 0 && !indexes.includes(index)) indexes.push(index);
        }
        return indexes.sort((a, b) => a - b);
      },
    });
    this.cleanup = this.virtualizer._didMount();
  }

  update(args) {
    if (this.disposed) return;
    if (this.args && !args.reset && this.args.view !== args.view) {
      this.pendingAnchor = this.visibleAnchor();
    }
    this.args = args;
    this.container.dataset.view = args.view;
    if (args.reset) {
      this.pendingAnchor = null;
      this.lastAnchor = null;
      this.nodes.forEach((node) => node.remove());
      this.nodes.clear();
      this.cleanup();
      this.rows = [];
      if (this.root) this.root.scrollTop = 0;
      else window.scrollTo(0, 0);
      this.createVirtualizer();
    }
    this.empty.innerHTML = args.results.length
      ? ""
      : emptyHistoryMarkup(args.state);
    this.updateFooter();
    this.configure();
    this.paint();
    this.schedule();
  }

  configure() {
    if (!this.args) return;
    const columns =
      Number(
        getComputedStyle(this.container).getPropertyValue("--history-columns"),
      ) || 1;
    const layout = `${columns}:${this.args.view}`;
    const layoutChanged = this.layout !== layout;
    // Image heights can change before ResizeObserver runs. Use the anchor
    // from the previous paint, before the new geometry exposes another row.
    if (layoutChanged && !this.pendingAnchor)
      this.pendingAnchor = this.lastAnchor || this.visibleAnchor();
    this.columns = columns;
    this.layout = layout;
    this.rows = historyRows(this.args.results, {
      sort: this.args.sort,
      columns,
    });
    const margin =
      this.canvas.getBoundingClientRect().top +
      (this.root
        ? this.root.scrollTop -
          this.root.getBoundingClientRect().top -
          this.root.clientTop
        : window.scrollY);
    if (layoutChanged) {
      this.nodes.forEach((node) => node.remove());
      this.nodes.clear();
      this.cleanup();
      this.createVirtualizer();
    }
    this.virtualizer.setOptions({
      ...this.virtualizer.options,
      count: this.rows.length,
      getItemKey: (index) => this.rows[index].key,
      scrollMargin: margin,
      enabled: this.container.getClientRects().length > 0,
    });
    // During a layout change we restore the video anchor ourselves. Letting
    // measurement adjustments also shift the viewport would apply it twice.
    this.virtualizer.shouldAdjustScrollPositionOnItemSizeChange = this
      .pendingAnchor
      ? () => false
      : undefined;
    this.canvas.style.height = `${this.virtualizer.getTotalSize()}px`;
    if (layoutChanged && this.pendingAnchor) {
      const index = this.rows.findIndex((row) =>
        row.videos?.some(
          ({ video }) =>
            (video.entryId || video.strIdent) === this.pendingAnchor.id,
        ),
      );
      const item = this.virtualizer.getMeasurements()[index];
      if (item)
        this.virtualizer.setOptions({
          ...this.virtualizer.options,
          initialOffset: item.start - this.pendingAnchor.offset,
        });
    }
    this.virtualizer._willUpdate();
    this.restoreAnchor();
  }

  visibleAnchor() {
    const top = this.root?.getBoundingClientRect().top || 0;
    const node = [...this.canvas.children].find(
      (node) =>
        node.querySelector(".video-item") &&
        node.getBoundingClientRect().bottom > top,
    );
    const id = node?.querySelector("[data-history-entry]")?.dataset
      .historyEntry;
    return id
      ? { id, offset: node.getBoundingClientRect().top - top, attempts: 0 }
      : null;
  }

  restoreAnchor() {
    const anchor = this.pendingAnchor;
    if (!anchor) return;
    const index = this.rows.findIndex((row) =>
      row.videos?.some(
        ({ video }) => (video.entryId || video.strIdent) === anchor.id,
      ),
    );
    const measurement =
      index < 0 ? null : this.virtualizer.getMeasurements()[index];
    if (!measurement || anchor.attempts++ >= 8) {
      this.pendingAnchor = null;
      return;
    }
    const offset = measurement.start - anchor.offset;
    if (Math.abs((this.root?.scrollTop ?? window.scrollY) - offset) > 1)
      this.virtualizer.scrollToOffset(offset);
    this.schedule();
  }

  estimateSize(index) {
    if (this.rows[index]?.separator) return 32;
    if (this.rows[index]?.day) return this.root ? 32 : 44;
    if (this.args?.view === "grid")
      return (
        (((this.container.clientWidth - ((this.columns || 4) - 1) * 12) /
          (this.columns || 4)) *
          9) /
          16 +
        12
      );
    return this.root ? 72 : 102;
  }

  schedule() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.configure();
      this.paint();
      this.checkLoadMore();
    });
  }

  paint() {
    if (!this.args || this.disposed) return;
    const items = this.virtualizer.getVirtualItems();
    const keys = new Set(items.map((item) => item.key));
    for (const [key, node] of this.nodes) {
      if (keys.has(key)) continue;
      node.remove();
      this.nodes.delete(key);
    }
    let cursor = this.canvas.firstElementChild;
    for (const item of items) {
      const row = this.rows[item.index];
      let node = this.nodes.get(item.key);
      if (!node) {
        node = document.createElement("div");
        node.className = "history-virtual-row";
        node.dataset.key = item.key;
        this.nodes.set(item.key, node);
      }
      const html = row.day
        ? `<div class="day-heading"><h3>${escapeHtml(row.day)}</h3></div>`
        : row.separator
          ? '<div class="history-undated-divider" role="separator" aria-label="Undated history"></div>'
          : `<ul class="video-list">${row.videos.map(({ video, index }) => videoCard(video, row.fullDate, Boolean(this.args.onDelete), index, this.args.state.totalResults)).join("")}</ul>`;
      if (node.markup !== html) {
        node.innerHTML = html;
        node.markup = html;
      }
      node.dataset.index = item.index;
      node.style.transform = `translateY(${item.start - this.virtualizer.options.scrollMargin}px)`;
      // Keep DOM order aligned with visual order for keyboard navigation.
      if (node !== cursor) this.canvas.insertBefore(node, cursor);
      cursor = node.nextSibling;
      this.virtualizer.measureElement(node);
    }
    this.virtualizer.measureElement(null);
    this.canvas.style.height = `${this.virtualizer.getTotalSize()}px`;
    this.thumbnails?.disconnect();
    this.thumbnails = observeThumbnails(this.canvas, { root: this.root });
    this.lastAnchor = this.visibleAnchor();
  }

  updateFooter() {
    const { state, results } = this.args;
    this.footer.hidden =
      state.isSearching ||
      (!results.length && !state.loadError) ||
      (!state.hasMore && !state.isLoadingMore && !state.loadError);
    this.footer.innerHTML = state.loadError
      ? `<span>${escapeHtml(state.loadError)}</span><button class="quiet-button" data-history-retry>Retry</button>`
      : state.hasMore || state.isLoadingMore
        ? '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span>Loading more…</span>'
        : "";
  }

  checkLoadMore() {
    if (this.disposed || !this.args || !this.container.getClientRects().length)
      return;
    const { state } = this.args;
    if (
      this.pendingAnchor ||
      !state.hasMore ||
      state.isSearching ||
      state.isLoadingMore ||
      state.loadError
    )
      return;
    const bottom =
      this.root?.getBoundingClientRect().bottom ?? window.innerHeight;
    if (this.footer.getBoundingClientRect().top <= bottom + 320)
      this.args.onLoadMore();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.thumbnails?.disconnect();
    this.intersection.disconnect();
    this.resize.disconnect();
    this.cleanup();
    this.container.removeEventListener("click", this.onClick);
  }
}

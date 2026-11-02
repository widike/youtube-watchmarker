import { HistoryVirtualList } from "../../extension/ui/history-virtual-list.js";

export async function verifyGroupedHistory(container, assert, waitFor) {
  window.scrollTo(0, 0);
  const library = new HistoryVirtualList(container);
  const timestamp = new Date(2026, 10, 1, 20).getTime();
  const plays = Array.from({ length: 18 }, (_, i) => ({
    strIdent: "aaaaaaaaaa0",
    strTitle: "Repeated video with a title that wraps across two lines",
    entryId: `repeat-${i}`,
    intTimestamp: timestamp - i * 60000,
    watchPrecision: "exact",
    durationSeconds: 600,
    watchedMilliseconds: (i + 1) * 1000,
    watchedPercent: i + 1,
  }));
  const args = {
    results: plays.slice(0, 2),
    sort: "newest",
    view: "grid",
    state: { totalResults: plays.length, hasMore: false },
    onDelete() {},
  };
  container.style.width = "288px";
  container.style.setProperty("--history-columns", "1");
  try {
    library.update({ ...args, reset: true });
    assert(
      container.querySelectorAll(".video-item").length === 1,
      "Repeats rendered duplicate cards",
    );
    assert(
      container.querySelectorAll(".video-watch-date").length === 2,
      "Initial play times are missing",
    );
    library.update({ ...args, results: plays });
    for (const view of ["grid", "list"]) {
      library.update({ ...args, results: plays, view });
      await waitFor(() => !library.pendingAnchor);
      const card = container.querySelector(".video-item");
      const link = card.querySelector(".video-link");
      assert(
        card.getAttribute("aria-setsize") === "1",
        "Accessible count includes repeated plays",
      );
      assert(
        container.querySelectorAll(".video-item").length === 1,
        "Appending repeated plays added thumbnails",
      );
      assert(
        card.querySelectorAll(".video-watch-date").length === plays.length,
        "A repeated play time disappeared",
      );
      assert(
        card.querySelectorAll(".video-duration").length === 1,
        "Video duration is repeated",
      );
      const bounds = link.getBoundingClientRect();
      const title = card.querySelector(".video-title").getBoundingClientRect();
      for (const time of card.querySelectorAll(
        ".video-play > time, .video-play > span",
      )) {
        const rect = time.getBoundingClientRect();
        assert(
          rect.top >= title.bottom - 1,
          `${view}: play time overlaps the title`,
        );
        assert(
          rect.bottom <= bounds.bottom &&
            rect.left >= bounds.left &&
            rect.right <= bounds.right,
          `${view}: play time clipped by the thumbnail`,
        );
      }
      assert(
        library.rows.filter((row) => row.videos).length === 1,
        "Virtual rows still contain repeats",
      );
    }
  } finally {
    library.dispose();
    container.style.width = "";
    container.style.removeProperty("--history-columns");
  }
}

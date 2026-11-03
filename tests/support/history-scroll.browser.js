const results = [];
const fixture = window.fixture;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
async function waitFor(predicate, message) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await pause();
  }
  throw new Error(
    `${message || "Timed out waiting for history UI"}: ${JSON.stringify({ errors: fixture.errors, lastRequest: fixture.calls.at(-1), content: document.querySelector(".history-load-state")?.textContent })}`,
  );
}
const test = async (name, run) => {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
    throw error;
  }
};
const ids = (container) =>
  [...container.querySelectorAll("[data-video-delete]")].map(
    (button) => button.dataset.videoDelete,
  );
const cardCount = (container) =>
  container.querySelectorAll(".video-item").length;
const ready = (container) => container.getAttribute("aria-busy") === "false";
const loaded = () =>
  fixture.calls
    .filter((call) => call.action === "search-videos" && !call.query)
    .at(-1)?.offset || 0;
import { verifyPopupHistory } from "./popup-history.browser.js";
import { verifyGroupedHistory } from "./history-day-groups.browser.js";
let popupMetadata;

try {
  const popup = document.getElementById("idSearch_Results");
  await test("popup loads one batch and has no pagination controls", async () => {
    await waitFor(() => ready(popup) && cardCount(popup) > 0);
    assert(fixture.calls.length === 1, "Popup fetched ahead before scrolling");
    assert(
      fixture.historyShownBeforeStatistics,
      "Statistics delayed initial history",
    );
    assert(
      fixture.compactStatistics === true,
      "Popup requested full dashboard statistics",
    );
    assert(
      !document.getElementById("next-page") &&
        !document.querySelector("[data-page]"),
      "Pagination remains",
    );
    assert(cardCount(popup) < 30, "Popup did not virtualize the initial batch");
    assert(
      !document.getElementById("toggle-thumbnails"),
      "Popup thumbnail button remains",
    );
    assert(
      popup.querySelectorAll(".video-thumbnail").length === cardCount(popup),
      "Popup thumbnails missing with a previously disabled preference",
    );
    assert(
      popup.querySelector("img[data-src]"),
      "Offscreen thumbnails are not deferred",
    );
    popupMetadata = verifyPopupHistory(popup, assert);
  });
  await test("popup scrolls through twelve batches with a bounded DOM and returns to the beginning", async () => {
    for (let i = 1; i < 12; i++) {
      popup.scrollTop = popup.scrollHeight;
      await waitFor(
        () => loaded() >= i * 30 && ready(popup),
        `Popup did not load batch ${i}`,
      );
      assert(popup.scrollTop > 0, "Appending reset popup scrolling");
      assert(cardCount(popup) < 30, "Popup DOM grew with loaded history");
    }
    popup.scrollTop = 0;
    await waitFor(() => ids(popup).includes("aaaaaaaaaa0"));
    assert(
      fixture.calls.length === 12,
      "Scrolling back fetched loaded batches again",
    );
    const link = popup.querySelector(".video-link");
    link.focus();
    await pause();
    assert(
      document.activeElement === link,
      "Virtual rendering discarded keyboard focus",
    );
    assert(
      popup.querySelector(".video-item").getAttribute("aria-setsize") === "-1",
      "The final card count is unknown until all watch entries are loaded",
    );
  });
  await test("popup append failures preserve history, retry once, and stop at the end", async () => {
    fixture.failOffset = 360;
    popup.scrollTop = popup.scrollHeight;
    await waitFor(() => popup.querySelector("[data-history-retry]"));
    assert(cardCount(popup) > 0, "Append error erased loaded history");
    const requests = fixture.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert(
      fixture.calls.length === requests,
      "Append failure caused an automatic retry loop",
    );
    fixture.failOffset = null;
    popup.querySelector("[data-history-retry]").click();
    await waitFor(
      () =>
        loaded() === 360 &&
        ready(popup) &&
        !popup.querySelector("[data-history-retry]"),
    );
    popup.scrollTop = popup.scrollHeight;
    await waitFor(() => loaded() === 390 && ready(popup));
    popup.scrollTop = popup.scrollHeight;
    await waitFor(
      () => ready(popup) && popup.querySelector(".history-load-state").hidden,
    );
    const finalCalls = fixture.calls.length;
    await pause();
    assert(
      fixture.calls.length === finalCalls,
      "Requests continued after the end",
    );
  });
  await test("search resets the popup and an empty result can be cleared", async () => {
    const input = document.getElementById("idSearch_Query");
    input.value = "nothing";
    input.dispatchEvent(new Event("input"));
    await waitFor(
      () =>
        popup.querySelector(".history-empty h3")?.textContent ===
        "No videos found",
    );
    assert(popup.scrollTop === 0, "New query did not reset scrolling");
    document.getElementById("clear-search").click();
    await waitFor(() => ready(popup) && cardCount(popup) > 0);
    assert(
      ids(popup).includes("aaaaaaaaaa0"),
      "Cleared query did not return to the beginning",
    );
  });

  // Mount the actual library controller and markup in the same isolated Chrome
  // profile, replacing only extension runtime messaging with fixture records.
  window.dispatchEvent(new Event("pagehide"));
  const markup = new DOMParser().parseFromString(
    await (await fetch("/extension/content/index.html")).text(),
    "text/html",
  );
  markup
    .querySelectorAll("link[href]")
    .forEach((link) =>
      link.setAttribute(
        "href",
        new URL(
          link.getAttribute("href"),
          `${location.origin}/extension/content/index.html`,
        ).href,
      ),
    );
  document.head.innerHTML = markup.head.innerHTML;
  document.body.className = markup.body.className;
  document.body.innerHTML = markup.body.innerHTML;
  fixture.calls = [];
  fixture.total = 600;
  await pause();
  const { LibraryController } = await import(
    "/extension/content/options/history-controller.js"
  );
  const controller = new LibraryController({
    client: { sendMessage: (message) => chrome.runtime.sendMessage(message) },
    feedback: {
      error: (message) => {
        throw new Error(message);
      },
    },
    queryInput: document.getElementById("idSearch_Query"),
    searchButton: document.getElementById("idSearch_Lookup"),
    resultsContainer: document.getElementById("idSearch_Results"),
  });
  await controller.initialize();
  await controller.loadInitialResults();
  const library = controller.resultsContainer;
  await test("library loads more while window-scrolling and grid/list switches remain virtualized", async () => {
    assert(library.dataset.view === "grid", "Grid is not the default layout");
    assert(
      controller.library.columns === 4,
      "Desktop grid does not have four columns",
    );
    assert(
      !document.getElementById("history-result-range"),
      "Loaded count remains",
    );
    assert(
      !library.querySelector(".video-open"),
      "Separate open control remains",
    );
    const link = library.querySelector(".video-link");
    assert(
      link.querySelector(".video-meta").innerHTML === popupMetadata,
      "Popup and options history show different per-video statistics",
    );
    const thumb = link.querySelector(".video-thumbnail");
    assert(
      Math.abs(
        link.getBoundingClientRect().width -
          thumb.getBoundingClientRect().width,
      ) < 1,
      "Thumbnail does not fill the grid card",
    );
    assert(
      Math.abs(
        link.getBoundingClientRect().height -
          thumb.getBoundingClientRect().height,
      ) < 1,
      "Grid card retains space below the thumbnail",
    );
    document.querySelector('[data-history-view="list"]').click();
    await waitFor(() => !controller.library.pendingAnchor);
    assert(
      !document.getElementById("history-page-size"),
      "Page-size control remains",
    );
    for (let i = 1; i < 6; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await waitFor(
        () => controller.results.length >= (i + 1) * 50 && ready(library),
        `Library did not load batch ${i}`,
      );
      assert(window.scrollY > 0, "Append reset window scrolling");
      assert(cardCount(library) < 40, "Library list DOM is unbounded");
    }
    document.querySelector('[data-history-view="grid"]').click();
    await waitFor(() => !controller.library.pendingAnchor);
    assert(library.dataset.view === "grid", "Grid view did not apply");
    assert(controller.library.columns >= 2, "Grid columns did not apply");
    assert(cardCount(library) < 100, "Grid did not virtualize");
    assert(
      !document.getElementById("history-thumbnails"),
      "Thumbnail control remains",
    );
    assert(
      library.querySelectorAll(".video-thumbnail").length ===
        cardCount(library),
      "Grid thumbnails missing with a previously disabled preference",
    );
    const resizeAnchor = controller.library.visibleAnchor();
    library.style.width = "288px";
    library.style.setProperty("--history-columns", "1");
    await pause();
    await waitFor(() => !controller.library.pendingAnchor);
    const resized = library.querySelector(
      `[data-history-entry="${resizeAnchor.id}"]`,
    );
    assert(
      resized &&
        Math.abs(resized.getBoundingClientRect().top - resizeAnchor.offset) <=
          2,
      `Resize moved the visible video: ${JSON.stringify({ before: resizeAnchor, after: resized?.getBoundingClientRect().top })}`,
    );
    library.style.width = "";
    library.style.removeProperty("--history-columns");
    await pause();
    await waitFor(() => !controller.library.pendingAnchor);
    document.querySelector('[data-history-view="list"]').click();
    await waitFor(() => !controller.library.pendingAnchor);
    assert(
      library.querySelectorAll(".video-thumbnail").length ===
        cardCount(library),
      "List thumbnails missing after switching views",
    );
  });
  await test("new duration badges update automatically without resetting loaded history or scroll", async () => {
    await waitFor(() => ready(library));
    const count = controller.results.length;
    const offset = controller.nextOffset;
    const scroll = window.scrollY;
    const id = library.querySelector("[data-history-entry]").dataset
      .historyEntry;
    assert(
      !library.querySelector(`[data-history-entry="${id}"] .video-duration`),
      "Expected a card awaiting duration",
    );
    fixture.durationsReady = true;
    for (const listener of fixture.storageListeners)
      listener(
        {
          youtube_duration_cache_revision: {
            oldValue: "before",
            newValue: "after",
          },
        },
        "local",
      );
    await waitFor(() =>
      library.querySelector(`[data-history-entry="${id}"] .video-duration`),
    );
    assert(
      controller.results.length === count && controller.nextOffset === offset,
      "Metadata update reset pagination",
    );
    assert(
      Math.abs(window.scrollY - scroll) <= 2,
      "Metadata update moved the viewport",
    );
  });
  await test("library deletion preserves loaded history and corrects the next batch offset", async () => {
    window.confirm = () => true;
    const before = controller.results.length;
    const id = ids(library)[0];
    library.querySelector(`[data-video-delete="${id}"]`).click();
    await waitFor(
      () => !controller.results.some((video) => video.strIdent === id),
    );
    assert(
      controller.results.length >= before - 1,
      "Deletion reset loaded history",
    );
    assert(window.scrollY > 0, "Deletion reset scroll position");
    const offset = controller.nextOffset;
    window.scrollTo(0, document.body.scrollHeight);
    await waitFor(() =>
      fixture.calls.some(
        (call) => call.action === "search-videos" && call.offset === offset,
      ),
    );
    assert(
      !controller.results.some((video) => video.strIdent === id),
      "Deleted video reappeared",
    );
  });
  await test("date/sort filters reset the stream and scrolling reaches the final library record", async () => {
    document.getElementById("history-sort").value = "title";
    document.getElementById("history-sort").dispatchEvent(new Event("change"));
    await waitFor(() => ready(library) && controller.results.length === 50);
    assert(
      fixture.calls.at(-1).sort === "title" &&
        fixture.calls.at(-1).offset === 0,
      "Sort did not reset the stream",
    );
    document.getElementById("history-period").value = "week";
    document
      .getElementById("history-period")
      .dispatchEvent(new Event("change"));
    await waitFor(() => ready(library) && controller.results.length === 50);
    assert(
      fixture.calls.at(-1).period === "week" &&
        fixture.calls.at(-1).offset === 0,
      "Date filter did not reset the stream",
    );
    for (let i = 0; i < 15 && controller.state.hasMore; i++) {
      const before = controller.results.length;
      window.scrollTo(0, document.body.scrollHeight);
      await waitFor(
        () => controller.results.length > before || !controller.state.hasMore,
      );
    }
    await waitFor(() => !controller.state.hasMore);
    assert(
      controller.results.length === 599,
      "The library lost records while scrolling",
    );
    assert(cardCount(library) < 40, "Completed library retained every DOM row");
    assert(fixture.errors.length === 0, fixture.errors.join("\n"));
    controller.dispose();
    controller.library.dispose();
  });
  await test("same-day repeats share a thumbnail with every play time visible", () =>
    verifyGroupedHistory(library, assert, waitFor));
} catch (error) {
  if (!results.some((result) => !result.passed))
    results.push({
      name: "Initialize scroll checks",
      passed: false,
      error: error.stack,
    });
}
await fetch("/results", { method: "POST", body: JSON.stringify(results) });

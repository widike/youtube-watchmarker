export function verifyGridClockContrast(link, assert) {
  const watchedTime = link.querySelector(".video-watch-date");
  assert(
    getComputedStyle(watchedTime).color ===
      getComputedStyle(link.querySelector(".video-meta")).color,
    "Grid watch times are dark on the thumbnail overlay",
  );
}

export async function verifyHistorySyncRefresh({
  fixture,
  controller,
  library,
  assert,
  waitFor,
}) {
  await waitFor(() => !controller.library.pendingAnchor);
  const anchor = controller.library.visibleAnchor();
  const count = controller.results.length;
  const total = controller.state.totalResults;
  fixture.prepended = [
    {
      strIdent: "newest_____",
      strTitle: "New cloud arrival",
      intTimestamp: fixture.now + 1000,
      intCount: 1,
      watchPrecision: "exact",
    },
  ];
  for (const listener of fixture.storageListeners)
    listener(
      {
        watchmarker_history_revision: { oldValue: "before", newValue: "after" },
      },
      "local",
    );
  await waitFor(
    () =>
      controller.state.totalResults === total + 1 &&
      controller.results[0]?.strIdent === "newest_____" &&
      !controller.library.pendingAnchor,
  );
  assert(
    controller.results.length === count && controller.nextOffset === count,
    "Cloud refresh reset loaded pages",
  );
  const after = controller.library.visibleAnchor();
  assert(
    after?.id === anchor?.id && Math.abs(after.offset - anchor.offset) <= 2,
    "Cloud refresh moved the visible video",
  );
  assert(
    document
      .getElementById("history-result-count")
      .textContent.includes((total + 1).toLocaleString()),
    "History total stayed stale",
  );
  assert(
    library.getAttribute("aria-busy") === "false",
    "Cloud refresh left history busy",
  );
}

export async function verifyPopupStatistics({ $, assert, waitFor }) {
  await waitFor(() => $("#popup-statistics .stats-peek-values"));
  assert(
    $(".stats-peek-values").children.length === 3,
    "Missing rolling totals",
  );
  assert(
    $("#open-statistics").getBoundingClientRect().height <= 60,
    "Duration strip uses too much vertical space",
  );
  const stats = (await import("./statistics-fixture.browser.js")).statistics(
    "month",
  );
  const cards = [...document.querySelectorAll(".stats-peek-metric")];
  for (const [index, period] of ["day", "week", "month"].entries()) {
    const label = cards[index].querySelector("dt").getBoundingClientRect();
    const value = cards[index].querySelector("dd").getBoundingClientRect();
    assert(
      label.bottom <= value.top,
      "KPI label is not separated from its duration",
    );
    const minutes = Math.floor(stats.time.totals[period] * 60);
    const expected =
      minutes >= 60
        ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
        : `${minutes}m`;
    assert(
      cards[index].querySelector(".stats-peek-duration-value").textContent ===
        expected,
      `Incorrect ${period} duration`,
    );
  }
  assert(
    !$(
      ".stats-peek-bars, .stats-peek-count, .stats-peek-number, .stats-peek-heading",
    ),
    "Non-duration metrics remain",
  );
  const { popupStatistics } = await import(
    "../../extension/ui/popup-statistics.js"
  );
  const root = $("#popup-statistics");
  const original = root.innerHTML;
  const noTime = (await import("./statistics-fixture.browser.js")).statistics(
    "month",
    false,
    true,
  );
  root.innerHTML = popupStatistics(noTime);
  for (const value of document.querySelectorAll(".stats-peek-duration-value"))
    assert(
      value.textContent === "—",
      "Missing time fell back to counts or zero",
    );
  root.innerHTML = popupStatistics({
    ...stats,
    time: {
      ...stats.time,
      estimatedTotal: 1,
      totals: { day: 24, week: 168, month: 720 },
    },
  });
  for (const card of document.querySelectorAll(".stats-peek-metric")) {
    assert(card.scrollWidth <= card.clientWidth, "Long duration overflows");
    assert(card.textContent.includes("≈"), "Estimates lack their indicator");
  }
  root.innerHTML = popupStatistics({
    ...stats,
    time: { ...stats.time, totals: { ...stats.time.totals, day: 0 } },
  });
  assert(
    $(".stats-peek-duration").textContent.includes("No watch time recorded"),
    "Missing duration was presented as measured zero",
  );
  root.innerHTML = original;
  assert(
    $("#idSearch_Results").getBoundingClientRect().height > 200,
    "Statistics displaced the history list",
  );
  assert(
    $("#popup-statistics").scrollWidth <= $("#popup-statistics").clientWidth,
    "Popup statistics overflow",
  );
}

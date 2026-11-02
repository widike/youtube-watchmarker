import { statistics } from "./statistics-fixture.browser.js";
import { PERIODS } from "../../extension/statistics/statistics-dates.js";
import { number } from "../../extension/ui/statistics-format.js";
import { verifyImportedWeek } from "./statistics-imported-week.browser.js";

export async function verifyAverageWeek({ $, assert, waitFor, ready }) {
  await verifyImportedWeek(assert, waitFor);
  const fixture = window.statisticsFixture;
  fixture.noTime = true;
  for (const period of Object.keys(PERIODS)) {
    $(`[data-stats-period="${period}"]`).click();
    await waitFor(ready);
    const stats = statistics(period, false, true);
    const grid = $('[data-heatmap="week"]');
    const cells = [...grid.querySelectorAll("button")];
    assert(
      cells.length === 168,
      "Weekly chart must contain only 24 hours per day",
    );
    assert(
      cells.every((cell) => cell.dataset.level === "0"),
      `${period}: imports without hours invented hourly activity`,
    );
    assert(
      !/unknown|\?/i.test(grid.closest(".stats-card").textContent),
      "Weekly chart displays a placeholder for records without an hour",
    );
    const summaries = [
      ...document.querySelectorAll(".stats-week-summary strong"),
    ];
    assert(
      summaries.every(
        (cell, day) =>
          cell.textContent === number(stats.weekdayAverages[day].average, 2),
      ),
      "Weekday totals changed when hiding records without an hour",
    );
    cells[23].focus();
    cells[23].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert(document.activeElement === cells[47], "Hourly navigation failed");
    assert(
      grid.closest(".stats-card").querySelector("[data-cell-detail]")
        .textContent === cells[47].title,
      "Hour detail was not announced",
    );
    const first = cells[0].getBoundingClientRect();
    const lastHour = cells[23].getBoundingClientRect();
    const nextDay = cells[24].getBoundingClientRect();
    assert(
      first.top === lastHour.top && nextDay.top > first.top,
      "Weekly rows are misaligned",
    );
  }
  fixture.noTime = false;
  $('[data-stats-period="month"]').click();
  await waitFor(ready);
}

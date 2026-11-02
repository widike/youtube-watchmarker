import { statistics } from "./statistics-fixture.browser.js";
import {
  bindHeatmaps,
  calendar,
  calendarLegend,
} from "../../extension/ui/statistics-heatmaps.js";

export function verifyMixedCalendar(assert) {
  const stats = statistics("month");
  stats.daily = [
    { date: "2026-01-01", count: 20 },
    { date: "2026-01-02", count: 20 },
    { date: "2026-01-03", count: 7 },
  ];
  stats.time.daily = [{ date: "2026-01-02", count: 0.1 }];
  stats.time.first = "2026-01-02";
  stats.time.missingDaily = [];
  const root = document.createElement("section");
  root.className = "stats-card stats-calendar-card";
  root.style.width = "280px";
  root.innerHTML = `${calendar(stats, 2026)}${calendarLegend(stats)}<p data-cell-detail aria-live="polite"></p>`;
  document.body.append(root);
  try {
    bindHeatmaps(root);
    const cells = root.querySelectorAll(".stats-cell");
    assert(
      cells[0].dataset.level === "4" &&
        cells[1].dataset.level === "1" &&
        cells[2].dataset.level === "2" &&
        cells[3].dataset.level === "0",
      "Calendar did not choose between watch time and counts for each day",
    );
    assert(
      cells[0].title.includes("20 activity records") &&
        cells[1].title.includes("6 min 0 s") &&
        cells[2].title.includes("7 activity records"),
      "Calendar tooltips do not explain each day's metric",
    );
    cells[2].focus();
    assert(
      root.querySelector("[data-cell-detail]").textContent === cells[2].title,
      "Count fallback is missing from accessible day detail",
    );
    const legend = root.querySelector(".stats-legend");
    assert(
      legend.textContent.includes("Hours per day") &&
        legend.textContent.includes(
          "Records per day · when watch time is missing",
        ),
      "Mixed calendar legend does not explain both scales",
    );
    assert(
      legend.scrollWidth <= legend.clientWidth,
      "Mixed calendar legend overflows on narrow screens",
    );
  } finally {
    root.remove();
  }
}

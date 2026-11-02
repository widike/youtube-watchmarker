const fixture = window.statisticsFixture;
const results = [];
const $ = (selector) => document.querySelector(selector);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const waitFor = async (predicate) => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`UI timed out: ${fixture.errors.join("; ")}`);
};
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
    throw error;
  }
};
const ready = () =>
  $("#panel-statistics").getAttribute("aria-busy") === "false";
import { verifyPopupStatistics } from "./popup-statistics.browser.js";
import { verifyStatisticsPeriods } from "./statistics-periods.browser.js";
import { verifyAverageWeek } from "./statistics-week.browser.js";
import { verifyWordCloud } from "./statistics-words.browser.js";
import { verifyPageTemplates } from "./page-templates.browser.js";
function contrast(foreground, background) {
  const luminance = (color) => {
    const rgb = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map(Number);
    const linear = rgb.map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const [a, b] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (a + 0.05) / (b + 0.05);
}
try {
  if (document.body.classList.contains("popup")) {
    await check(
      "popup shows only durations with clearly separated periods",
      () => verifyPopupStatistics({ $, assert, waitFor }),
    );
    await check(
      "popup opens Insights through its actual navigation handler",
      async () => {
        $("#open-statistics").click();
        await waitFor(() => fixture.opened);
        assert(
          fixture.opened.endsWith("content/index.html#statistics"),
          "Wrong destination",
        );
        assert(fixture.closed, "Popup did not close");
        assert(!fixture.errors.length, fixture.errors.join("; "));
      },
    );
  } else {
    await check(
      "word cloud remains readable, compact and keyboard accessible",
      () => verifyWordCloud({ $, assert, waitFor, ready, contrast }),
    );
    await check(
      "all period controls refresh watch averages, title words and ranked video counts",
      async () => {
        await verifyStatisticsPeriods({ $, assert, waitFor, ready });
        await verifyAverageWeek({ $, assert, waitFor, ready });
      },
    );
    await check(
      "actual options app loads a complete, responsive statistics dashboard",
      async () => {
        await waitFor(() => $(".stats-word-cloud button") && ready());
        await verifyPageTemplates(assert);
        const durations = await import("./duration.browser.js");
        await durations.verifyDurationBackfill(assert);
        await durations.verifyDurationControls({ $, assert, waitFor });
        assert(!$("#panel-statistics").hidden, "Insights not selected");
        assert(
          document.querySelector(".stats-metric > span").textContent ===
            "Hours watched",
          "Duration does not lead",
        );
        assert(
          !document.querySelector("[data-stats-unit], #stats-unit"),
          "Unexpected units switch",
        );
        await (
          await import("./watch-time.browser.js")
        ).verifyDurationPersistence(assert);
        await (
          await import("./reconciliation-ui.browser.js")
        ).verifyReconciliationControls({ $, assert, waitFor, ready });

        assert(
          document.querySelectorAll("[data-stats-period]").length === 6,
          "Missing period choices",
        );
        assert(
          document.querySelectorAll('[data-heatmap="week"] button').length ===
            168,
          "Weekly heatmap incomplete",
        );
        assert(
          document.documentElement.scrollWidth <= innerWidth,
          "Options overflow horizontally",
        );
        assert(
          document.querySelectorAll(".stats-metric").length === 4,
          "Missing summary cards",
        );
        assert(
          ![...document.querySelectorAll("[data-stats-word]")].some((button) =>
            ["the", "and", "die", "a"].includes(button.textContent),
          ),
          "Filler words reached the cloud",
        );
        assert(
          !$("#panel-statistics table, #panel-statistics .stats-data"),
          "Raw data tables are still present",
        );
        if (!matchMedia("(forced-colors: active)").matches) {
          for (const label of document.querySelectorAll(".stats-legend span")) {
            const style = getComputedStyle(label);
            assert(
              contrast(style.color, style.backgroundColor) >= 4.5,
              `Low contrast legend: ${label.textContent}`,
            );
          }
        }
        const frame = document.createElement("iframe");
        frame.title = "Narrow statistics layout check";
        frame.style.cssText =
          "position:fixed;inset:0;width:320px;height:850px;border:0";
        const markup = document.documentElement.cloneNode(true);
        markup.querySelectorAll("script").forEach((script) => script.remove());
        const base = document.createElement("base");
        base.href = new URL("/content/index.html", location.href).href;
        markup.querySelector("head").prepend(base);
        const loaded = new Promise((resolve) =>
          frame.addEventListener("load", resolve, { once: true }),
        );
        frame.srcdoc = "<!doctype html>" + markup.outerHTML;
        document.body.append(frame);
        await loaded;
        assert(
          frame.contentDocument.documentElement.scrollWidth <= 320,
          "Statistics overflow at 320px",
        );
        frame.remove();
      },
    );
    await check(
      "calendar stacks compact years with one shared legend and day detail",
      async () => {
        const { verifyMixedCalendar } = await import(
          "./statistics-calendar.browser.js"
        );
        verifyMixedCalendar(assert);
        const years = [
          ...document.querySelectorAll(".stats-calendar-year h3"),
        ].map(({ textContent }) => textContent);
        assert(
          years.join(",") === "2026,2025,2024,2023,2022",
          "Incomplete or incorrectly ordered history range",
        );
        assert(
          !$(".stats-calendar-card select"),
          "Calendar still has a year selector",
        );
        const leapYear = $("#stats-calendar-2024").closest("section");
        assert(
          leapYear.querySelectorAll('[data-heatmap="calendar"] button')
            .length === 366,
          "Leap day missing",
        );
        const newest = $(".stats-calendar-year");
        assert(
          newest.querySelectorAll(".stats-cell").length === 305,
          "Current year should end today",
        );
        const card = $(".stats-calendar-card");
        assert(
          card.querySelectorAll(".stats-legend").length === 1 &&
            card.querySelectorAll("[data-cell-detail]").length === 1,
          "Calendar repeats its legend or day detail between years",
        );
        const nextYear = newest.nextElementSibling;
        assert(
          nextYear.getBoundingClientRect().top -
            newest.getBoundingClientRect().bottom <=
            12,
          "Too much space between years",
        );
        const cells = [
          ...leapYear.querySelectorAll('[data-heatmap="calendar"] button'),
        ];
        cells[0].focus();
        cells[0].dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        assert(
          document.activeElement === cells[7],
          "Calendar keyboard navigation failed",
        );
        assert(
          card.querySelector("[data-cell-detail]").textContent ===
            cells[7].getAttribute("aria-label"),
          "Date detail not announced",
        );
        const newestCell = newest.querySelector(".stats-cell");
        newestCell.focus();
        assert(
          card.querySelector("[data-cell-detail]").textContent ===
            newestCell.getAttribute("aria-label"),
          "Shared detail did not update when moving between years",
        );
      },
    );
    await check(
      "rapid period changes keep the latest selection and all calendar years",
      async () => {
        $('[data-stats-period="week"]').click();
        $('[data-stats-period="all"]').click();
        await waitFor(
          () =>
            ready() &&
            $('[data-stats-period="all"]').getAttribute("aria-pressed") ===
              "true",
        );
        await new Promise((resolve) => setTimeout(resolve, 120));
        assert(
          [...document.querySelectorAll(".stats-calendar-year h3")]
            .map(({ textContent }) => textContent)
            .join(",") === "2026,2025,2024,2023,2022",
          "Period update changed the calendar years",
        );
        assert(
          $(".stats-metric:nth-child(3)").title.includes("saved library"),
          "Stale period response replaced current data",
        );
        const cells = [
          ...document.querySelectorAll('[data-heatmap="week"] button'),
        ];
        cells[0].focus();
        cells[0].dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
        assert(
          document.activeElement === cells[24],
          "Weekly keyboard navigation failed",
        );
      },
    );
    await check(
      "errors retain loaded charts and refresh recovers empty and populated states",
      async () => {
        fixture.fail = true;
        $("[data-stats-refresh]").click();
        await waitFor(
          () =>
            ready() &&
            $("[data-stats-status]").textContent.includes("Could not"),
        );
        assert($(".stats-metric"), "Failed refresh erased loaded statistics");
        fixture.fail = false;
        fixture.empty = true;
        $("[data-stats-refresh]").click();
        await waitFor(() => ready() && $(".stats-empty"));
        assert(
          !$("[data-stats-content]").textContent.includes("NaN"),
          "Invalid empty state",
        );
        fixture.empty = false;
        $("[data-stats-refresh]").click();
        await waitFor(() => ready() && $("[data-stats-word]"));
      },
    );
    await check(
      "word cloud selection searches the actual history library",
      async () => {
        const word = $("[data-stats-word]").dataset.statsWord;
        $("[data-stats-word]").click();
        await waitFor(() => !$("#panel-history").hidden);
        assert(
          $("#idSearch_Query").value === word,
          "Search input did not receive selected word",
        );
        assert(
          fixture.calls.some(
            ({ action, query, wordGroup }) =>
              action === "search-videos" &&
              query === word &&
              wordGroup === word,
          ),
          "Word did not trigger library search",
        );
        location.hash = "statistics";
        await waitFor(() => !$("#panel-statistics").hidden && ready());
        assert(!fixture.errors.length, fixture.errors.join("; "));
      },
    );
  }
} catch {
  /* Checks record actionable failures. */
}
await fetch("/results", { method: "POST", body: JSON.stringify(results) });

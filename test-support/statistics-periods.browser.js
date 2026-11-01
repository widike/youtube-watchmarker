import { statistics } from "./statistics-fixture.browser.js";
import { PERIODS } from "../statistics-dates.js";
import { number } from "../ui/statistics-format.js";
import { verifyCalendarDatabase } from "./statistics-database.browser.js";

export async function verifyStatisticsPeriods({ $, assert, waitFor, ready }) {
  await waitFor(() => $(".stats-word-cloud button") && ready());
  await verifyCalendarDatabase(assert);
  const seen = {
    favorites: new Set(),
    words: new Set(),
    averages: new Set(),
  };
  for (const period of Object.keys(PERIODS)) {
    $(`[data-stats-period="${period}"]`).click();
    await waitFor(() => ready());
    const expected = statistics(period);
    const metric = [...document.querySelectorAll(".stats-metric")].find(
      (row) => row.querySelector("span").textContent === "Recorded activity",
    );
    assert(
      metric?.querySelector("strong").textContent === number(expected.selected),
      `Incorrect reconciled activity total for ${period}`,
    );
    assert(
      !$("[data-stats-content]").textContent.includes("repeat watches"),
      "Mixed-source records are still presented as verified repeat watches",
    );
    for (const summary of document.querySelectorAll(
      ".stats-calendar-summary",
    )) {
      const year = summary.querySelector("h3").textContent;
      const total = expected.daily
        .filter(({ date }) => date.startsWith(`${year}-`))
        .reduce((sum, { count }) => sum + count, 0);
      assert(
        summary
          .querySelector("span")
          .textContent.endsWith(`${number(total)} records`),
        `Incorrect ${year} calendar total for ${period}`,
      );
      const heading = summary.querySelector("h3").getBoundingClientRect();
      const detail = summary.querySelector("span").getBoundingClientRect();
      assert(
        detail.left >= heading.right && detail.top < heading.bottom,
        "Calendar summary is not beside the year",
      );
    }
    const favorites = [...document.querySelectorAll(".stats-favorites li")].map(
      (row) => ({
        id: new URL(row.querySelector("a").href).searchParams.get("v"),
        count: row.querySelector("strong").firstChild.textContent,
      }),
    );
    const words = [...document.querySelectorAll("[data-stats-word]")].map(
      (button) => ({
        word: button.dataset.statsWord,
        title: button.title,
      }),
    );
    const averages = [
      ...document.querySelectorAll(".stats-week-summary strong"),
    ].map((cell) => cell.textContent);
    assert(
      JSON.stringify(favorites) ===
        JSON.stringify(
          expected.favorites.map((row) => ({
            id: row.strIdent,
            count: number(row.count),
          })),
        ),
      `Stale favorites for ${period}`,
    );
    assert(
      JSON.stringify(words) ===
        JSON.stringify(
          expected.words.map(({ word, count }) => ({
            word,
            title: `${word} · ${number(count)} different videos`,
          })),
        ),
      `Stale words for ${period}`,
    );
    assert(
      JSON.stringify(averages) ===
        JSON.stringify(
          expected.weekdayAverages.map(({ average }) => number(average, 2)),
        ),
      `Stale weekday averages for ${period}`,
    );
    seen.favorites.add(JSON.stringify(favorites));
    seen.words.add(JSON.stringify(words));
    seen.averages.add(JSON.stringify(averages));
  }
  for (const [name, values] of Object.entries(seen))
    assert(values.size > 1, `${name} never changed between periods`);
  const fixture = window.statisticsFixture;
  fixture.noTime = true;
  $('[data-stats-period="month"]').click();
  await waitFor(() => ready());
  assert(
    [...document.querySelectorAll(".stats-week-summary strong")].some(
      (cell) => cell.textContent !== number(0),
    ),
    "Weekday watch averages are empty when playback duration is unavailable",
  );
  assert(
    !$("[data-stats-content]").textContent.match(
      /unavailable|No duration data|Hours watched|Daily viewing time|Viewing time/i,
    ),
    "Missing playback duration produced empty metrics or unavailable labels",
  );
  assert(
    !$(".stats-calendar-card [aria-label*='unavailable']"),
    "Calendar still announces unavailable duration",
  );
  assert(
    $(".stats-calendar-card .stats-legend").getAttribute("aria-label") ===
      "Records per day",
    "Count-only calendar still uses an hours legend",
  );
  assert(
    $(".stats-calendar-card .stats-cell:not([data-level='0'])"),
    "Saved watch activity is invisible without measured duration",
  );
  fixture.noTime = false;
  $('[data-stats-period="month"]').click();
  await waitFor(() => ready());
}

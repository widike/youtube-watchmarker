import { DATABASE } from "../constants.js";
import { upgradeHistoryStorage } from "../history-storage.js";
import { IndexedDBProvider } from "../indexeddb-provider.js";
import { summarizeHistory } from "../history-statistics.js";
import { DAY, PERIODS } from "../statistics-dates.js";
import { StatisticsController } from "../ui/statistics-controller.js";

// Reproduce existing installations: timestamps in the original video store
// migrate into saved events labeled "inferred", not tracked playback events.
export async function verifyImportedWeek(assert, waitFor) {
  const name = `watchmarker-imported-week-${crypto.randomUUID()}`;
  const now = new Date(2026, 10, 2, 18).getTime();
  const originals = Array.from({ length: 7 }, (_, day) =>
    [8, 12, 16].map((hour) => ({
      strIdent: `${day}${hour}`.padStart(11, "v"),
      strTitle: "Historical video",
      intTimestamp: new Date(2026, 10, 2 - day, hour, 30).getTime(),
      intCount: 1,
    })),
  ).flat();
  const open = (version) =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        if (version === 1) {
          const store = request.result.createObjectStore(DATABASE.STORE_NAME, {
            keyPath: "strIdent",
          });
          for (const row of originals) store.put(row);
        } else upgradeHistoryStorage(request.result, request.transaction);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  let db = await open(1);
  db.close();
  db = await open(2);
  db.close();
  db = await open(2);
  const root = document.createElement("section");
  root.innerHTML =
    "<div data-stats-periods></div><div data-stats-content></div><p data-stats-status></p>";
  const provider = new IndexedDBProvider({ database: db, isInitialized: true });
  const controller = new StatisticsController({
    root,
    client: {
      sendMessage: async ({ period }) => ({
        success: true,
        statistics: summarizeHistory(await provider.getAllVideos(), {
          period,
          now,
        }),
      }),
    },
  });
  try {
    const saved = await provider.getAllVideos();
    assert(
      saved.length === 21 &&
        saved.every((row) => row.watchEvents[0].precision === "inferred"),
      "Migration did not retain the historical timestamps that reproduce the bug",
    );
    controller.initialize();
    await waitFor(() => root.getAttribute("aria-busy") === "false");
    for (const [period, { days }] of Object.entries(PERIODS)) {
      root.querySelector(`[data-stats-period="${period}"]`).click();
      await waitFor(() => root.getAttribute("aria-busy") === "false");
      assert(
        controller.stats?.period === period,
        "Imported history period did not load",
      );
      const expected = Array(168).fill(0);
      for (const { intTimestamp } of originals) {
        if (days && intTimestamp < now - days * DAY) continue;
        const date = new Date(intTimestamp);
        expected[((date.getDay() + 6) % 7) * 24 + date.getHours()]++;
      }
      const grid = root.querySelector('[data-heatmap="week"]');
      const cells = [...grid.querySelectorAll("button")];
      assert(cells.length === 168, "Unexpected column in the weekly grid");
      for (const [index, count] of expected.entries())
        assert(
          (cells[index].dataset.level !== "0") === count > 0,
          `${period}: saved timestamp missing or misplaced at weekday ${Math.floor(index / 24)}, hour ${index % 24}`,
        );
      assert(
        !/unknown|\?/i.test(grid.closest(".stats-card").textContent),
        "Unexpected placeholder label",
      );
      if (period === "week")
        assert(
          cells.filter((cell) => cell.dataset.level !== "0").length === 21,
          "Saved timestamps must highlight all seven weekdays at their three recorded hours",
        );
    }
  } finally {
    controller.dispose();
    db.close();
    indexedDB.deleteDatabase(name);
  }
}

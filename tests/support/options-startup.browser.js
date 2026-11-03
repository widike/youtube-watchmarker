const fixture = window.startupFixture;
const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
async function waitFor(condition) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (condition()) return;
    await pause();
  }
  throw new Error(`Startup did not finish: ${fixture.errors.join("\n")}`);
}
try {
  const history = document.getElementById("idSearch_Results");
  await waitFor(() => history.querySelector(".video-item"));
  assert(
    history.getAttribute("aria-busy") === "false",
    "History is still loading",
  );
  assert(
    !document.getElementById("panel-preferences"),
    "Settings panels were not delayed",
  );
  assert(
    fixture.calls.length === 1 && fixture.calls[0].action === "search-videos",
    "Unrelated requests ran before the first history batch",
  );
  assert(
    history.textContent.includes("History loads first"),
    "Initial history is not usable while settings load",
  );
  assert(
    document.getElementById("idDatabase_Size").textContent === "…",
    "Sidebar was not delayed",
  );
  const userChoosesGrid = location.search.includes("chosen");
  if (userChoosesGrid)
    document.querySelector('[data-history-view="grid"]').click();
  fixture.releasepanels();
  await waitFor(() => document.getElementById("panel-preferences"));
  fixture.releaselocal();
  await waitFor(() => document.documentElement.dataset.theme === "dark");
  await waitFor(
    () => history.dataset.view === (userChoosesGrid ? "grid" : "list"),
  );
  assert(
    history.querySelector(".video-item"),
    "Restoring the layout lost the loaded history",
  );
  assert(
    document
      .querySelector(
        `[data-history-view="${userChoosesGrid ? "grid" : "list"}"]`,
      )
      .getAttribute("aria-pressed") === "true",
    "Layout controls do not match the restored view",
  );
  fixture.releasepreferences();
  fixture.releasesidebar();
  await waitFor(
    () => document.getElementById("idDatabase_Size").textContent === "1",
  );
  assert(
    fixture.calls.filter((request) => request.action === "search-videos")
      .length === 1,
    "Finishing settings loaded the initial history twice",
  );
  assert(fixture.errors.length === 0, fixture.errors.join("\n"));
  results.push({
    name: userChoosesGrid
      ? "early layout choice survives delayed saved preferences"
      : "history renders before panels, preferences, sidebar and cloud status",
    passed: true,
  });
} catch (error) {
  results.push({ name: "Options startup", passed: false, error: error.stack });
} finally {
  for (const name of ["panels", "local", "preferences", "sidebar"])
    fixture[`release${name}`]();
}
await fetch("/results", { method: "POST", body: JSON.stringify(results) });

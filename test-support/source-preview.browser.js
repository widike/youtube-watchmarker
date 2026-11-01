export async function checkSourcePreviews(fixture, waitFor) {
  const element = (selector) => document.querySelector(selector);
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const checking = () => element("#refresh-sources").hasAttribute("aria-busy");
  const previews = () =>
    fixture.requests.filter(({ action }) => action === "source-preview").length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(previews() === 0, "Opening Sync started a source check");
  location.hash = "history";
  location.hash = "sync";
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(previews() === 0, "Navigation started a source check");
  fixture.delaySources = true;
  element("#refresh-sources").click();
  await waitFor(() => fixture.pendingSourceChecks?.length === 3);
  assert(!element("#refresh-sources").disabled, "Cancel check is disabled");
  element("#refresh-sources").click();
  await waitFor(() => !checking());
  assert(
    fixture.requests.some(({ action }) => action === "source-preview-cancel"),
    "Cancellation was not sent to the background",
  );
  assert(
    element("#source-youtube-status").textContent === "Cancelled",
    "Cancellation status is missing",
  );
  fixture.delaySources = false;
  element("#refresh-sources").click();
  await waitFor(() => !element("#source-history-metrics").hidden);
  await waitFor(() => !checking());
  fixture.sourceError = "youtube";
  fixture.pendingSourceChecks.forEach((resolve) => resolve());
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    element("#source-youtube-status").textContent === "",
    "Cancelled check overwrote the new result",
  );
  for (const source of ["history", "youtube", "likes"]) {
    const metrics = element(`#source-${source}-metrics`);
    assert(!metrics.hidden, `${source} preview is hidden`);
    assert(
      metrics.querySelector('[data-count="totalCount"]').textContent ===
        new Intl.NumberFormat().format(1200),
      `${source} total is incorrect`,
    );
    assert(
      metrics.querySelector('[data-count="existingCount"]').textContent ===
        "900",
      "Existing count is incorrect",
    );
    assert(
      metrics.querySelector('[data-count="newCount"]').textContent === "300",
      "New count is incorrect",
    );
  }
  assert(
    !fixture.requests.some(({ action }) => action === "history-synchronize"),
    "Checking sources imported videos",
  );
  fixture.sourceError = "youtube";
  element("#refresh-sources").click();
  await waitFor(() =>
    element("#source-youtube-status").textContent.includes("Sign in"),
  );
  assert(
    element("#source-youtube-metrics").hidden,
    "Failed preview retained stale counts",
  );
  assert(
    !element("#source-history-metrics").hidden,
    "A failed source hid successful counts",
  );
  fixture.sourceError = null;
  await waitFor(() => !checking());
  element("#refresh-sources").click();
  await waitFor(() => !element("#source-youtube-metrics").hidden);
  await waitFor(() => !checking());
  const beforeSync = previews();
  element("#sync-history").click();
  await waitFor(
    () => element("#source-history-status").textContent === "Not checked",
  );
  assert(
    previews() === beforeSync,
    "Importing automatically started a source check",
  );
  element("#refresh-sources").click();
  await waitFor(
    () =>
      element('#source-likes-metrics [data-count="newCount"]').textContent ===
      "0",
  );
  assert(
    element('#source-history-metrics [data-count="existingCount"]')
      .textContent === new Intl.NumberFormat().format(1200),
    "Counts were not updated after importing",
  );
  assert(fixture.errors.length === 0, fixture.errors.join("\n"));
}

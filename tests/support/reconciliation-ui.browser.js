export async function verifyReconciliationControls({
  $,
  assert,
  waitFor,
  ready,
}) {
  location.hash = "sync";
  await waitFor(() => !$("#panel-sync").hidden);
  const root = $("[data-reconciliation]");
  const primary = root.querySelector("[data-reconcile-primary]");
  const cancel = root.querySelector('[data-reconcile="decline"]');
  const fixture = window.statisticsFixture.reconciliation;
  const idle = () => root.getAttribute("aria-busy") === "false";
  const waitForAction = (operation) =>
    waitFor(() => idle() && primary.dataset.reconcile === operation);
  const visibleButtons = () =>
    [...root.querySelectorAll("button")].filter((button) => !button.hidden);
  await waitForAction("preview");
  assert(fixture.approved === 0, "Opening settings applied a repair");
  assert(visibleButtons().length === 1, "Idle cleanup has extra actions");
  assert(!root.querySelector("[data-reconcile-copy]"), "Cleanup exposes SQL");
  primary.focus();
  primary.click();
  assert(primary.disabled, "Scan allows repeated requests");
  assert(root.getAttribute("aria-busy") === "true", "Scan is not announced");
  await waitForAction("approve");
  assert(!primary.disabled, "Preview cannot be approved");
  assert(document.activeElement === primary, "Scan lost keyboard focus");
  assert(
    root.textContent.includes("1,000 duplicate watches") ||
      root.textContent.includes("1.000 duplicate watches"),
    "Missing clear cleanup impact",
  );
  assert(
    !root.querySelector(".summary-list, input[type=checkbox]"),
    "Cleanup exposes unrelated statistics or individual approval",
  );
  assert(visibleButtons().length === 2, "Preview has extra actions");
  const examples = root.querySelector("details");
  assert(examples && !examples.open, "Video details should start collapsed");
  examples.open = true;
  assert(
    examples.textContent.includes("Affected example") &&
      examples.textContent.includes("2") &&
      examples.textContent.includes("1"),
    "Review does not show affected videos and count changes",
  );
  const frame = document.createElement("iframe");
  frame.title = "Narrow import cleanup review";
  frame.style.cssText =
    "position:fixed;inset:0;width:320px;height:650px;border:0";
  const loaded = new Promise((resolve) =>
    frame.addEventListener("load", resolve, { once: true }),
  );
  frame.srcdoc = `<!doctype html><html><head>
    <link rel="stylesheet" href="/extension/content/ui.css">
    <link rel="stylesheet" href="/extension/content/options.css">
    <style>body { padding: 16px; }</style>
    </head><body>${root.outerHTML}</body></html>`;
  document.body.append(frame);
  try {
    await loaded;
    assert(
      frame.contentDocument.documentElement.scrollWidth <= 320,
      "Expanded cleanup review overflows at 320px",
    );
  } finally {
    frame.remove();
  }
  assert(fixture.approved === 0, "Preview applied the cleanup");
  cancel.click();
  await waitForAction("preview");
  assert(root.textContent.includes("No changes made"), "Cancel is unclear");
  assert(
    fixture.approved === 0 && fixture.declined === 1,
    "Cancel changed history",
  );
  fixture.ready = false;
  primary.click();
  await waitFor(
    () => idle() && root.textContent.includes("Supabase migration"),
  );
  assert(
    primary.dataset.reconcile === "preview" &&
      primary.textContent === "Check again",
    "Blocked cleanup allows approval or has no readiness retry",
  );
  fixture.ready = true;
  primary.click();
  await waitForAction("approve");
  primary.click();
  primary.click();
  await waitForAction("sync");
  assert(
    root.textContent.includes("Cloud sync is pending"),
    "Missing sync state",
  );
  assert(fixture.approved === 1, "Cleanup required multiple approvals");
  assert(visibleButtons().length === 1, "Completed cleanup has extra actions");
  primary.click();
  await waitForAction("preview");
  assert(
    root.textContent.includes("Cloud sync verified"),
    "Missing sync result",
  );
  assert(fixture.approved === 1, "Sync retry reapplied the cleanup");

  // Exercise persisted and failed states through the same controller and DOM.
  const { ReconciliationController } = await import(
    "../../extension/content/options/reconciliation-controller.js"
  );
  const copy = root.cloneNode(true);
  copy
    .querySelectorAll("[id]")
    .forEach((element) => element.removeAttribute("id"));
  root.after(copy);
  let fail = true;
  const controller = new ReconciliationController({
    root: copy,
    client: {
      sendMessage: async () => {
        if (fail) throw new Error("Connection interrupted. Try again.");
        return {
          success: true,
          plan: { ...fixture.plan, status: "applying" },
          cloud: { ready: true },
        };
      },
    },
    onDataChanged: async () => {},
  });
  try {
    const action = copy.querySelector("[data-reconcile-primary]");
    await controller.run("status");
    assert(
      action.dataset.reconcile === "status" &&
        !action.disabled &&
        copy.textContent.includes("Connection interrupted"),
      "Failed load cannot be retried safely",
    );
    fail = false;
    await controller.run("status");
    assert(
      action.textContent === "Resume cleanup" &&
        !action.disabled &&
        action.dataset.reconcile === "approve",
      "Interrupted cleanup has no resume action",
    );
    controller.response = {
      plan: { ...fixture.plan, status: "preview", removed: 0, videos: 0 },
      cloud: { ready: false },
    };
    controller.render();
    assert(
      copy.textContent.includes("No duplicate imports found") &&
        action.dataset.reconcile === "preview" &&
        !action.disabled &&
        !copy.querySelector("details") &&
        copy.querySelector('[data-reconcile="decline"]').hidden,
      "Empty scan exposes unnecessary cleanup or setup controls",
    );
    assert(
      document.documentElement.scrollWidth <= innerWidth,
      "Cleanup overflows",
    );
  } finally {
    copy.remove();
  }
  location.hash = "statistics";
  await waitFor(() => !$("#panel-statistics").hidden && ready());
}

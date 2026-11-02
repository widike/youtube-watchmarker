export async function verifyReconciliationControls({
  $,
  assert,
  waitFor,
  ready,
}) {
  location.hash = "sync";
  await waitFor(() => !$("#panel-sync").hidden);
  const root = $("[data-reconciliation]");
  const button = (operation) =>
    root.querySelector(`[data-reconcile="${operation}"]`);
  const fixture = window.statisticsFixture.reconciliation;
  await waitFor(() => !button("preview").disabled);
  assert(fixture.approved === 0, "Opening settings applied a repair");
  button("preview").click();
  await waitFor(() => button("approve") && !button("approve").disabled);
  assert(
    root.textContent.includes("1,000") || root.textContent.includes("1.000"),
    "Missing aggregate batch count",
  );
  assert(
    root.querySelectorAll("input[type=checkbox]").length === 0,
    "Videos require individual approval",
  );
  assert(
    root.querySelectorAll('[data-reconcile="approve"]').length === 1,
    "Missing single batch approval",
  );
  assert(fixture.approved === 0, "Preview applied the repair");
  button("decline").click();
  await waitFor(() => root.textContent.includes("Batch declined"));
  assert(
    fixture.approved === 0 && fixture.declined === 1,
    "Decline changed history",
  );
  fixture.ready = false;
  button("preview").click();
  await waitFor(
    () => button("approve") && root.textContent.includes("Supabase migration"),
  );
  assert(button("approve").disabled, "Approval allowed without server support");
  fixture.ready = true;
  button("preview").click();
  await waitFor(() => button("approve") && !button("approve").disabled);
  button("approve").click();
  await waitFor(
    () => button("sync") && root.textContent.includes("verification pending"),
  );
  assert(fixture.approved === 1, "Batch required more than one approval");
  button("sync").click();
  await waitFor(() => root.textContent.includes("sync verified"));
  assert(fixture.approved === 1, "Sync retry reapplied the batch approval");
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    "Reconciliation preview overflows",
  );
  location.hash = "statistics";
  await waitFor(() => !$("#panel-statistics").hidden && ready());
}

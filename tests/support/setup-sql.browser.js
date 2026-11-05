export async function verifySetupSqlButton(fixture, assert, waitFor) {
  const button = document.getElementById("setup-sql");
  assert(
    button.closest(".section-heading") &&
      button.checkVisibility() &&
      button.textContent.trim() === "Copy setup SQL",
    "Setup SQL is not directly available in the cloud toolbar",
  );
  assert(!document.getElementById("sync-setup-toggle"), "Setup gear remains");
  assert(
    !document
      .getElementById("sync-connected")
      .textContent.includes("Enter the six-letter code on your other device"),
    "Redundant connection-code instruction remains",
  );
  const summary = document.getElementById("sync-summary");
  const before = summary.getBoundingClientRect();
  button.focus({ preventScroll: true });
  button.click();
  await waitFor(() =>
    fixture.copiedTexts.some((text) => text.includes("begin;")),
  );
  const sql = fixture.copiedTexts.find((text) => text.includes("begin;"));
  assert(sql.includes("youtube_blocked_videos"), "Block-list setup is missing");
  assert(sql.trim().endsWith("commit;"), "Setup transaction was not copied");
  assert(
    document.getElementById("sync-setup").hidden,
    "Copying SQL exposed connection setup",
  );
  assert(document.activeElement === button, "Copying SQL moved focus");
  const after = summary.getBoundingClientRect();
  for (const edge of ["x", "y", "width", "height"])
    assert(after[edge] === before[edge], `Copying SQL changed summary ${edge}`);
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    "Cloud toolbar overflows horizontally",
  );
}

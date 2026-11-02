import { checkSourcePreviews } from "./source-preview.browser.js";

const results = [];
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`UI check timed out: ${window.fixture.errors.join("\n")}`);
}
try {
  await waitFor(() => document.querySelector("#source-history-metrics"));
  await checkSourcePreviews(window.fixture, waitFor);
  if (document.documentElement.scrollWidth > window.innerWidth) {
    throw new Error("Source previews overflow the viewport");
  }
  const expected = window.fixture.expected;
  if (
    expected === "narrow dark reduced motion" &&
    !matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    throw new Error("Dark mode was not enabled");
  }
  if (
    expected === "forced colors" &&
    !matchMedia("(forced-colors: active)").matches
  ) {
    throw new Error("Forced colors were not enabled");
  }
  results.push({
    name: "Manual source checks, cancellation, retry, and invalidation after import",
    passed: true,
  });
} catch (error) {
  results.push({ name: "Source previews", passed: false, error: error.stack });
}
await fetch("/results", { method: "POST", body: JSON.stringify(results) });

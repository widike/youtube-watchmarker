import assert from "node:assert/strict";
import test from "node:test";
import { Logger } from "../extension/shared/logger.js";

test("Chrome extension error summaries retain the failure message and stack", (t) => {
  const output = t.mock.method(console, "error", () => {});
  const error = new Error("YouTube history continuation HTTP 403");
  error.code = "YOUTUBE_REQUEST_FAILED";
  new Logger("Watchmarker").error("Startup synchronization failed:", error);

  // Chrome's extension errors list joins console arguments into text.
  const args = output.mock.calls[0].arguments;
  const summary = args.map(String).join(" ");
  assert.match(summary, /YouTube history continuation HTTP 403/);
  assert.doesNotMatch(summary, /\[object Object\]/);
  assert.deepEqual(JSON.parse(args[2]), {
    name: error.name,
    message: error.message,
    code: error.code,
    stack: error.stack,
  });
});

test("browser timeout errors remain readable in warning summaries", (t) => {
  const output = t.mock.method(console, "warn", () => {});
  const error = new DOMException("YouTube request timed out", "TimeoutError");
  new Logger("Watchmarker").warn("Source preview failed:", error);

  const args = output.mock.calls[0].arguments;
  assert.match(args.map(String).join(" "), /YouTube request timed out/);
  assert.equal(JSON.parse(args[2]).name, "TimeoutError");
});

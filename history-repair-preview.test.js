import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReconciliationPlan,
  publicReconciliationPlan,
} from "./history-repair-preview.js";
import { mergeVideo } from "./history-records.js";

test("one preview covers a thousand affected videos and exposes aggregate statistics", () => {
  const now = new Date(2026, 10, 1, 12).getTime();
  const rows = Array.from({ length: 1000 }, (_, index) => {
    const source = {
      strIdent: String(index).padStart(11, "0"),
      strTitle: `Video ${index}`,
      intTimestamp: now - 1000,
      intCount: 1,
    };
    return mergeVideo(source, { ...source, intTimestamp: now });
  });
  const original = JSON.stringify(rows);
  const plan = buildReconciliationPlan(rows, now);
  const summary = publicReconciliationPlan(plan);
  assert.equal(summary.removed, 1000);
  assert.equal(summary.videos, 1000);
  assert.equal(summary.before, 2000);
  assert.equal(summary.after, 1000);
  assert.equal(summary.playbacks, 0);
  assert.equal(summary.undated, 0);
  assert.equal(summary.status, "preview");
  assert.equal(summary.examples.length, 10);
  assert.equal(Object.hasOwn(summary, "items"), false);
  assert.equal(plan.items.length, 1000);
  assert.equal(JSON.stringify(rows), original);
});

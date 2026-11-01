import assert from "node:assert/strict";
import test from "node:test";
import { SettingsManager } from "./settings-manager.js";

test("watch count defaults on and badge styles update without resetting preferences", async (t) => {
  const original = globalThis.chrome;
  t.after(() => {
    globalThis.chrome = original;
  });
  const stored = {
    idVisualization_Showdate: false,
    stylesheet_Showdate: "old date stylesheet",
    stylesheet_Showbadge: "old badge stylesheet",
  };
  let writes = 0;
  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => ({ ...stored }),
        set: async (changes) => {
          writes++;
          Object.assign(stored, changes);
        },
      },
    },
  };
  await new SettingsManager().initialize();
  assert.equal(stored.idVisualization_Showcount, true);
  assert.equal(stored.idVisualization_Showdate, false);
  assert.match(stored.stylesheet_Showcount, /attr\(watchcount\)/);
  assert.match(stored.stylesheet_Showdate, /--youwatch-date/);
  assert.match(stored.stylesheet_Showbadge, /var\(--youwatch-count/);
  stored.idVisualization_Showcount = false;
  await new SettingsManager().initialize();
  assert.equal(stored.idVisualization_Showcount, false);
  assert.equal(writes, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  historyImportCutoff,
  isHistoricalWatch,
} from "./history-import-policy.js";

const today = new Date(2026, 10, 2).getTime();

test("the historical boundary is persisted once and survives later days and concurrent requests", async () => {
  const saved = {};
  let writes = 0;
  const storage = {
    get: async () => ({ ...saved }),
    set: async (values) => {
      writes++;
      Object.assign(saved, values);
    },
  };
  assert.deepEqual(
    await Promise.all([
      historyImportCutoff(storage, today + 3600_000),
      historyImportCutoff(storage, today + 2 * 3600_000),
    ]),
    [today, today],
  );
  assert.equal(await historyImportCutoff(storage, today + 86_400_000), today);
  assert.equal(writes, 1);
});

test("storage errors and invalid boundaries fail closed instead of allowing imports", async () => {
  for (const measuredHistoryStart of [null, 0, -1, "123", Infinity]) {
    await assert.rejects(
      historyImportCutoff({
        get: async () => ({ measuredHistoryStart }),
      }),
      /Invalid measured history boundary/,
    );
  }
  const storage = {
    get: async () => ({}),
    set: async () => {
      throw new Error("Storage unavailable");
    },
  };
  await assert.rejects(
    historyImportCutoff(storage, today),
    /Storage unavailable/,
  );
  storage.set = async () => {};
  assert.equal(await historyImportCutoff(storage, today), today);
});

test("historical backfill rejects unknown dates, the boundary and any overlapping day", () => {
  for (const intTimestamp of [undefined, null, 0, NaN, today, today + 1])
    assert.equal(isHistoricalWatch({ intTimestamp }, today), false);
  assert.equal(isHistoricalWatch({ intTimestamp: today - 1 }, today), true);
  assert.equal(
    isHistoricalWatch(
      {
        intTimestamp: today,
        watchEvents: [{ watchedAt: today, precision: "day" }],
      },
      today + 3_600_000,
    ),
    false,
  );
  const yesterday = new Date(2026, 10, 1).getTime();
  assert.equal(
    isHistoricalWatch(
      {
        intTimestamp: yesterday,
        watchEvents: [{ watchedAt: yesterday, precision: "day" }],
      },
      today,
    ),
    true,
  );
});

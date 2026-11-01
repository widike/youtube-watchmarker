import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSource } from "./source-preview.js";

test("preview handles empty sources, large sources, and retained database tombstones", async () => {
  let reads = 0;
  const provider = {
    getVideo: async (id, options) => {
      reads++;
      assert.equal(options.includeDeleted, true);
      return Number(id) % 2 ? null : { strIdent: id, deletedAt: 1000 };
    },
  };
  assert.partialDeepStrictEqual(await summarizeSource([], provider), {
    totalCount: 0,
    existingCount: 0,
    newCount: 0,
  });
  const ids = Array.from({ length: 250 }, (_, index) => String(index));
  assert.partialDeepStrictEqual(
    await summarizeSource([...ids, ...ids], provider),
    {
      totalCount: 250,
      existingCount: 125,
      newCount: 125,
    },
  );
  assert.equal(reads, 250);
});

test("database read failures fail the preview instead of counting records as missing", async () => {
  await assert.rejects(
    summarizeSource(["aaaaaaaaaaa"], {
      getVideo: async () => {
        throw new Error("Database unavailable");
      },
    }),
    /Database unavailable/,
  );
});

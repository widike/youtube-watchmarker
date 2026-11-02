import test from "node:test";
import assert from "node:assert/strict";
import { HistorySearchController } from "../../extension/ui/history-search-controller.js";
import { historyRows } from "../../extension/ui/history-library.js";

const video = (id) => ({ strIdent: id, strTitle: id, intTimestamp: 0 });
const a = video("aaaaaaaaaaa");
const b = video("bbbbbbbbbbb");
const c = video("ccccccccccc");

function fixture() {
  const pending = [];
  const renders = [];
  const queryInput = { value: "old", addEventListener() {} };
  const controller = new HistorySearchController({
    client: {
      sendMessage: (message) =>
        new Promise((resolve, reject) =>
          pending.push({ message, resolve, reject }),
        ),
    },
    feedback: { error: () => assert.fail("Unexpected error") },
    queryInput,
    resultsContainer: { classList: { toggle() {} }, setAttribute() {} },
    renderResults: ({ results, reset }) =>
      renders.push({ results: [...results], reset }),
    batchSize: 2,
  });
  const respond = (index, results, totalResults = 3) =>
    pending[index].resolve({ success: true, objVideos: results, totalResults });
  return { controller, queryInput, pending, renders, respond };
}

test("slow batches and stale errors cannot overwrite a newer cleared query", async () => {
  const { controller, queryInput, pending, respond } = fixture();
  const old = controller.search();
  queryInput.value = "";
  const current = controller.search();
  assert.equal(pending[1].message.query, "");
  respond(1, [a], 1);
  await current;
  pending[0].reject(new Error("Old connection failed"));
  await old;
  assert.deepEqual(controller.results, [a]);
  assert.equal(controller.state.isSearching, false);
  assert.equal(controller.state.loadError, "");
});

test("scroll requests append in bounded batches, serialize and stop at the end", async () => {
  const { controller, pending, respond } = fixture();
  const first = controller.search();
  respond(0, [a, b]);
  await first;
  assert.deepEqual(pending[0].message, {
    action: "search-videos",
    query: "old",
    offset: 0,
    limit: 2,
  });
  const next = controller.loadMore();
  await controller.loadMore();
  assert.equal(pending.length, 2);
  assert.equal(pending[1].message.offset, 2);
  respond(1, [c]);
  await next;
  assert.deepEqual(controller.results, [a, b, c]);
  assert.equal(controller.state.hasMore, false);
  await controller.loadMore();
  assert.equal(pending.length, 2);
});

test("word-family searches survive pagination and filter refreshes, then clear for a new query", async () => {
  const { controller, queryInput, pending, respond } = fixture();
  queryInput.value = "build";
  const first = controller.search({ wordGroup: "build" });
  assert.equal(pending[0].message.wordGroup, "build");
  respond(0, [a, b]);
  await first;
  const next = controller.loadMore();
  assert.equal(pending[1].message.wordGroup, "build");
  respond(1, [c]);
  await next;
  const refresh = controller.search();
  assert.equal(pending[2].message.wordGroup, "build");
  respond(2, [a], 1);
  await refresh;
  queryInput.value = "bu";
  const typed = controller.search();
  assert.equal(pending[3].message.wordGroup, undefined);
  respond(3, [b], 1);
  await typed;
});

test("append errors keep loaded videos and retry the same offset without looping", async () => {
  const { controller, pending, respond } = fixture();
  const first = controller.search();
  respond(0, [a, b]);
  await first;
  const next = controller.loadMore();
  pending[1].reject(new Error("Offline"));
  await next;
  assert.deepEqual(controller.results, [a, b]);
  assert.match(controller.state.loadError, /more videos/);
  await controller.loadMore();
  assert.equal(pending.length, 2);
  const retry = controller.retry();
  assert.equal(pending[2].message.offset, 2);
  respond(2, [c]);
  await retry;
  assert.deepEqual(controller.results, [a, b, c]);
  assert.equal(controller.state.loadError, "");
});

test("an initial failure can retry and a new search discards a pending append", async () => {
  const { controller, pending, respond, queryInput } = fixture();
  const first = controller.search();
  pending[0].reject(new Error("Offline"));
  await first;
  const retry = controller.retry();
  respond(1, [a, b]);
  await retry;
  const append = controller.loadMore();
  queryInput.value = "fresh";
  const fresh = controller.search();
  respond(3, [c], 1);
  await fresh;
  respond(2, [a, b]);
  await append;
  assert.deepEqual(controller.results, [c]);
  assert.equal(pending[3].message.offset, 0);
});

test("overlapping records are deduplicated and an empty batch stops loading", async () => {
  const { controller, pending, respond } = fixture();
  const first = controller.search();
  respond(0, [a, b], 8);
  await first;
  const next = controller.loadMore();
  respond(1, [b, c], 8);
  await next;
  assert.deepEqual(controller.results, [a, b, c]);
  const last = controller.loadMore();
  respond(2, [], 8);
  await last;
  assert.equal(controller.state.hasMore, false);
  assert.equal(pending[2].message.offset, 4);
});

test("deletion adjusts the next offset so the following video is not skipped", async (t) => {
  const previousConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  t.after(() => {
    if (previousConfirm) globalThis.confirm = previousConfirm;
    else delete globalThis.confirm;
  });
  const { controller, pending, respond } = fixture();
  const first = controller.search();
  respond(0, [a, b]);
  await first;
  const deletion = controller.deleteVideo(a.strIdent, { disabled: false });
  pending[1].resolve({ success: true });
  await deletion;
  assert.deepEqual(controller.results, [b]);
  const next = controller.loadMore();
  assert.equal(pending[2].message.offset, 1);
  respond(2, [c], 2);
  await next;
  assert.deepEqual(controller.results, [b, c]);
});

test("disposing ignores responses that arrive after the page closes", async () => {
  const { controller, respond, renders } = fixture();
  const first = controller.search();
  const before = renders.length;
  controller.dispose();
  respond(0, [a, b]);
  await first;
  assert.equal(renders.length, before);
  assert.deepEqual(controller.results, []);
});

test("virtual rows group dates continuously and retain positions across grid rows", () => {
  const rows = historyRows([a, b, c], { sort: "newest", columns: 2 });
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows[0].videos.map(({ index }) => index),
    [0, 1],
  );
  assert.deepEqual(
    rows[1].videos.map(({ index }) => index),
    [2],
  );
  assert.equal(new Set(rows.map(({ key }) => key)).size, rows.length);
});

test("pagination preserves separate watch events for the same video", async () => {
  const { controller, respond } = fixture();
  const firstWatch = { ...a, entryId: "watch-1", intTimestamp: 300 };
  const secondWatch = { ...a, entryId: "watch-2", intTimestamp: 200 };
  const thirdWatch = { ...a, entryId: "watch-3", intTimestamp: 100 };
  const first = controller.search();
  respond(0, [firstWatch, secondWatch]);
  await first;
  const next = controller.loadMore();
  respond(1, [thirdWatch]);
  await next;
  assert.deepEqual(controller.results, [firstWatch, secondWatch, thirdWatch]);
  assert.equal(controller.state.totalResults, 3);
});

test("duration refresh updates loaded cards without resetting pagination or rendering", async () => {
  const { controller, respond, pending, renders } = fixture();
  const first = controller.search();
  respond(0, [a, b], 6);
  await first;
  const next = controller.loadMore();
  respond(1, [c], 6);
  await next;
  const state = structuredClone(controller.state);
  const offset = controller.nextOffset;
  const refresh = controller.refreshMetadata();
  assert.equal(pending[2].message.limit, 3);
  respond(
    2,
    [{ ...a, durationSeconds: 600 }, b, { ...c, durationSeconds: 900 }],
    6,
  );
  await refresh;
  assert.equal(controller.results[0].durationSeconds, 600);
  assert.equal(controller.results[2].durationSeconds, 900);
  assert.equal(controller.nextOffset, offset);
  assert.deepEqual(controller.state, state);
  assert.equal(renders.at(-1).reset, false);
});

test("metadata refresh cannot overwrite a new query and failures retain usable cards", async () => {
  const { controller, queryInput, respond, pending } = fixture();
  const first = controller.search();
  respond(0, [a, b]);
  await first;
  const refresh = controller.refreshMetadata();
  queryInput.value = "new";
  const search = controller.search();
  respond(2, [c], 1);
  await search;
  respond(1, [{ ...a, durationSeconds: 600 }, b]);
  await refresh;
  respond(3, [c], 1);
  await new Promise(setImmediate);
  assert.deepEqual(controller.results, [c]);
  const failed = controller.refreshMetadata();
  pending[4].reject(new Error("offline"));
  await failed;
  assert.deepEqual(controller.results, [c]);
  assert.equal(controller.state.loadError, "");
});

test("duration changes during pagination refresh the earlier cards after loading finishes", async () => {
  const { controller, respond, pending } = fixture();
  const first = controller.search();
  respond(0, [a, b]);
  await first;
  const next = controller.loadMore();
  await controller.refreshMetadata();
  assert.equal(pending.length, 2);
  respond(1, [c]);
  await next;
  assert.equal(pending[2].message.limit, 3);
  respond(2, [{ ...a, durationSeconds: 600 }, b, c]);
  await new Promise(setImmediate);
  assert.equal(controller.results[0].durationSeconds, 600);
  assert.equal(controller.results.length, 3);
});

test("partial deletion removes local cards and displays the retry error", async (t) => {
  const previousConfirm = globalThis.confirm;
  globalThis.confirm = () => true;
  t.after(() => {
    globalThis.confirm = previousConfirm;
  });
  const { controller, respond, pending } = fixture();
  const errors = [];
  controller.feedback.error = (message) => errors.push(message);
  const first = controller.search();
  respond(0, [a, b]);
  await first;
  const deletion = controller.deleteVideo(a.strIdent, { disabled: false });
  pending[1].resolve({
    success: false,
    deleted: true,
    error: "YouTube: sign in to finish deletion",
  });
  await deletion;
  assert.deepEqual(controller.results, [b]);
  assert.equal(controller.nextOffset, 1);
  assert.deepEqual(errors, ["YouTube: sign in to finish deletion"]);
});

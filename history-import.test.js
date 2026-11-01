import assert from "node:assert/strict";
import test from "node:test";
import { parseHistoryImport } from "./history-import.js";
import { mergeVideoData, normalizeVideo } from "./history-records.js";
import { databaseProviderFactory } from "./database-provider-factory.js";
import {
  handleDatabaseExport,
  handleDatabaseImport,
} from "./handlers/database-handlers.js";

const video = {
  strIdent: "abcdefghijk",
  intTimestamp: 1793520000000,
  strTitle: 'Grüße — 東京 😀 "quoted" \\ title',
  intCount: 4,
};
// Matches the upstream btoa(unescape(encodeURIComponent(JSON.stringify(...)))).
const databaseFile = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const formats = {
  "current JSON array": (rows) => JSON.stringify(rows),
  "original objVideos wrapper": (rows) => JSON.stringify({ objVideos: rows }),
  "original response envelope": (rows) =>
    JSON.stringify({
      strMessage: "databaseExport",
      objResponse: { objVideos: rows },
    }),
  "original .database file": databaseFile,
  "base64 wrapped JSON": (rows) => databaseFile({ objVideos: rows }),
};

for (const [name, encode] of Object.entries(formats)) {
  test(`imports ${name} with Unicode titles, original timestamps and counts`, () => {
    assert.deepEqual(parseHistoryImport(encode([video])), [
      normalizeVideo(video),
    ]);
    assert.deepEqual(parseHistoryImport(encode([])), []);
  });
}

test("keeps existing JSON containers and snake_case field normalization", () => {
  const row = {
    str_ident: video.strIdent,
    int_timestamp: String(video.intTimestamp),
    str_title: video.strTitle,
    int_count: "4",
  };
  for (const wrapped of [
    { data: [row] },
    { rows: [row] },
    { providers: { indexedDB: [row] } },
    { providers: { supabase: [row] } },
  ]) {
    assert.deepEqual(parseHistoryImport(JSON.stringify(wrapped)), [
      normalizeVideo(video),
    ]);
  }
});

test("accepts BOMs, whitespace and line-wrapped base64", () => {
  assert.deepEqual(
    parseHistoryImport(`\uFEFF \n${JSON.stringify([video])}\n`),
    [normalizeVideo(video)],
  );
  const encoded = databaseFile([video])
    .match(/.{1,60}/g)
    .join("\r\n");
  assert.deepEqual(parseHistoryImport(`\uFEFF \n${encoded}\n`), [
    normalizeVideo(video),
  ]);
});

test("retains control-character recovery and repairs mojibake titles", () => {
  const raw = JSON.stringify([{ ...video, strTitle: "GrÃ¼ße\tline\nnext" }])
    .replace("\\t", "\t")
    .replace("\\n", "\n");
  assert.equal(parseHistoryImport(raw)[0].strTitle, "Grüße\tline\nnext");
});

test("rejects invalid files, envelopes, records and encoded UTF-8", () => {
  for (const raw of [
    "",
    "not a backup",
    '{"objVideos":[}',
    "null",
    "42",
    JSON.stringify({ objVideos: {} }),
    JSON.stringify({ unrelated: [video] }),
    databaseFile({ unrelated: [video] }),
    JSON.stringify([null]),
    JSON.stringify(["video"]),
    JSON.stringify([{}]),
    Buffer.from([0xff, 0xfe]).toString("base64"),
  ]) {
    assert.throws(() => parseHistoryImport(raw), undefined, raw);
  }
});

function importProvider(t, initial = []) {
  let stored = mergeVideoData(initial);
  const writes = [];
  t.mock.method(databaseProviderFactory, "getCurrentProvider", () => ({
    getAllVideos: async () => stored,
    importVideos: async (rows) => {
      writes.push(rows);
      stored = mergeVideoData(stored, rows);
    },
  }));
  return { writes, read: () => stored };
}

test("both formats merge into existing history and repeated imports are idempotent", async (t) => {
  const existing = [
    { ...video, strIdent: "lmnopqrstuv" },
    { ...video, intTimestamp: video.intTimestamp + 1000 },
  ];
  const provider = importProvider(t, existing);
  for (const encode of Object.values(formats)) {
    const result = await handleDatabaseImport({ data: encode([video]) });
    assert.equal(result.success, true, result.error);
  }
  assert.deepEqual(provider.read(), mergeVideoData(existing, [video]));
  assert.equal(provider.read().length, 2);
  assert.equal(provider.read()[1].intCount, 4);
});

test("real export/import handlers retain events, imported counts and deletion markers", async (t) => {
  const original = normalizeVideo({
    ...video,
    intImportedCount: 0,
    intDeletedAt: video.intTimestamp + 1,
    watchEvents: [
      {
        eventId: "playback:first",
        watchedAt: video.intTimestamp,
        source: "playback",
        precision: "exact",
        observedDeletion: 0,
      },
      {
        eventId: "playback:second",
        watchedAt: video.intTimestamp,
        source: "playback",
        precision: "exact",
        observedDeletion: 0,
      },
    ],
  });
  const provider = importProvider(t, [original]);
  const exported = await handleDatabaseExport();
  assert.equal(exported.success, true);
  assert.deepEqual(parseHistoryImport(exported.data), [original]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await handleDatabaseImport({ data: exported.data });
    assert.equal(result.success, true, result.error);
  }
  assert.deepEqual(provider.writes, [[original], [original]]);
  assert.deepEqual(provider.read(), [original]);
});

test("wrapped large imports use the chunked import path", async (t) => {
  const provider = importProvider(t);
  const rows = Array.from({ length: 1001 }, (_, i) => ({
    ...video,
    strIdent: String(i).padStart(11, "0"),
  }));
  const result = await handleDatabaseImport({ data: databaseFile(rows) });
  assert.equal(result.success, true, result.error);
  assert.equal(result.totalItems, 1001);
  assert.deepEqual(
    provider.writes.map((chunk) => chunk.length),
    [1000, 1],
  );
  assert.equal(provider.read().length, 1001);
});

test("invalid records fail before any chunk is written", async (t) => {
  const provider = importProvider(t, [video]);
  const rows = Array.from({ length: 1001 }, () => video);
  for (const badRow of [null, {}, { ...video, watchEvents: [{}] }]) {
    const result = await handleDatabaseImport({
      data: JSON.stringify({ objVideos: [...rows, badRow] }),
    });
    assert.equal(result.success, false);
    assert.ok(result.error);
  }
  assert.deepEqual(provider.writes, []);
  assert.deepEqual(provider.read(), [normalizeVideo(video)]);
});

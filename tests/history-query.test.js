import test from "node:test";
import assert from "node:assert/strict";
import { queryHistory } from "../extension/history/history-query.js";
import { historyDay, escapeHtml } from "../extension/ui/history-library.js";

const now = new Date(2026, 10, 1, 12).getTime();
const today = new Date(2026, 10, 1).getTime();
const videos = [
  {
    strIdent: "aaaaaaaaaaa",
    strTitle: "Zebra & friends",
    intTimestamp: today,
    intCount: 1,
  },
  {
    strIdent: "bbbbbbbbbbb",
    strTitle: "A calm afternoon",
    intTimestamp: new Date(2026, 9, 26, 23).getTime(),
    intCount: 8,
  },
  {
    strIdent: "ccccccccccc",
    strTitle: "An older video",
    intTimestamp: new Date(2026, 9, 25, 23).getTime(),
    intCount: 3,
  },
  {
    strIdent: "ddddddddddd",
    strTitle: "No date",
    intTimestamp: 0,
    intCount: 1,
  },
];

test("history filters use local calendar days, including across DST", () => {
  assert.deepEqual(
    queryHistory(videos, { period: "today", now }).map((v) => v.strIdent),
    ["aaaaaaaaaaa"],
  );
  assert.equal(queryHistory(videos, { period: "week", now }).length, 2);
  assert.equal(queryHistory(videos, { period: "month", now }).length, 3);
  assert.equal(queryHistory(videos, { now }).length, 4);
});

test("search and sort apply across the library without mutating records", () => {
  assert.equal(
    queryHistory(videos, { query: "  CALM ", now })[0].strIdent,
    "bbbbbbbbbbb",
  );
  assert.equal(
    queryHistory(videos, { query: "cccc", now })[0].strTitle,
    "An older video",
  );
  assert.equal(queryHistory(videos, { sort: "most", now })[0].intCount, 8);
  assert.equal(
    queryHistory(videos, { sort: "title", now })[0].strTitle,
    "A calm afternoon",
  );
  assert.equal(
    queryHistory(videos, { sort: "oldest", now }).at(-1).strTitle,
    "No date",
  );
  assert.equal(videos[0].strTitle, "Zebra & friends");
});

test("missing dates do not become January 1970 and imported titles are escaped", () => {
  assert.equal(historyDay(0), "");
  assert.equal(historyDay(today, new Date(now)), "Today");
  assert.equal(
    historyDay(new Date(2026, 9, 31, 10).getTime(), new Date(now)),
    "Yesterday",
  );
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

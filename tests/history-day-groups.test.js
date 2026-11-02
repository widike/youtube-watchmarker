import test from "node:test";
import assert from "node:assert/strict";
import { groupHistoryDays } from "../extension/ui/history-day-groups.js";
import { historyRows, videoCard } from "../extension/ui/history-library.js";
import { queryHistory } from "../extension/history/history-query.js";

const play = (entryId, hour, extra = {}) => ({
  entryId,
  strIdent: "abcdefghijk",
  strTitle: "Repeated <video>",
  intTimestamp: new Date(2026, 10, 1, hour).getTime(),
  watchPrecision: "exact",
  ...extra,
});
const cards = (rows) => rows.flatMap((row) => row.videos || []);

test("same video and local day share a card, preserving order and original sessions", () => {
  const latest = play("latest", 19);
  const other = play("other", 18, { strIdent: "bbbbbbbbbbb" });
  const earlier = play("earlier", 9, { durationSeconds: 600 });
  const yesterday = play("yesterday", 23, {
    intTimestamp: new Date(2026, 9, 31, 23).getTime(),
  });
  const undated = play("undated", 0, { intTimestamp: 0, unknownViews: 3 });
  const input = [latest, other, earlier, yesterday, undated];
  const before = JSON.stringify(input);
  const grouped = groupHistoryDays(input);
  assert.equal(grouped.length, 4);
  assert.deepEqual(grouped[0].plays, [latest, earlier]);
  assert.equal(grouped[0].entryId, "latest");
  assert.equal(grouped[0].durationSeconds, 600);
  assert.equal(grouped[1].strIdent, other.strIdent);
  assert.deepEqual(grouped[2].plays, [yesterday]);
  assert.equal(grouped[3], undated);
  assert.equal(JSON.stringify(input), before);
});

test("all sort orders group repeats before creating grid rows and retain distinct days", () => {
  const input = [
    play("late", 20),
    play("early", 8),
    play("other", 15, { strIdent: "bbbbbbbbbbb", strTitle: "Other video" }),
    play("midnight", 0),
    play("previous", 0, {
      intTimestamp: new Date(2026, 9, 31, 23, 59).getTime(),
    }),
  ];
  for (const sort of ["newest", "oldest", "title", "most"]) {
    const rows = historyRows(queryHistory(input, { sort }), {
      sort,
      columns: 2,
    });
    const displayed = cards(rows);
    assert.equal(displayed.length, 3, sort);
    assert.deepEqual(
      displayed.map(({ index }) => index),
      [0, 1, 2],
    );
    assert.equal(
      displayed.filter(({ video }) => video.plays.length === 3).length,
      1,
    );
    assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  }
});

test("appending a later batch adds play times without another thumbnail or changing its key", () => {
  const first = play("first", 20);
  const second = play("second", 18);
  const third = play("third", 9);
  const initial = cards(
    historyRows([first, second], { sort: "newest", columns: 1 }),
  );
  const appended = cards(
    historyRows([first, second, third], { sort: "newest", columns: 1 }),
  );
  assert.equal(appended.length, 1);
  assert.equal(appended[0].video.entryId, initial[0].video.entryId);
  assert.deepEqual(appended[0].video.plays, [first, second, third]);
  assert.equal(initial[0].video.plays.length, 2);
});

test("one thumbnail shows all play times with their own measured duration and percentage", () => {
  const [group] = groupHistoryDays([
    play("first", 19, {
      durationSeconds: 600,
      watchedMilliseconds: 120000,
      watchedPercent: 20,
    }),
    play("second", 9, {
      durationSeconds: 600,
      watchedMilliseconds: 60000,
      watchedPercent: 10,
    }),
  ]);
  const html = videoCard(group, false, true, 0, 1);
  assert.equal((html.match(/<img /g) || []).length, 1);
  assert.equal((html.match(/class="video-duration"/g) || []).length, 1);
  assert.equal((html.match(/class="video-watch-date"/g) || []).length, 2);
  assert.equal((html.match(/data-video-delete=/g) || []).length, 1);
  assert.match(html, /2:00/);
  assert.match(html, /1:00/);
  assert.match(html, /20%/);
  assert.match(html, /10%/);
  assert.match(html, /Repeated &lt;video&gt;/);
  assert.doesNotMatch(html, /video-progress/);
});

test("same-minute plays survive, and day-only imports do not invent a watch time", () => {
  const exact = play("exact", 0);
  const [group] = groupHistoryDays([
    exact,
    { ...exact, entryId: "simultaneous" },
    { ...exact, entryId: "import", watchPrecision: "day" },
  ]);
  assert.equal(group.plays.length, 3);
  const html = videoCard(group, false, false, 0, 1);
  assert.equal((html.match(/<time /g) || []).length, 2);
  assert.equal((html.match(/class="video-play"/g) || []).length, 2);
  assert.doesNotMatch(html, /video-delete|video-watched-time|NaN|undefined/);
});

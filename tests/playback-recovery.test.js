import assert from "node:assert/strict";
import test from "node:test";
import {
  measuredPlaybacks,
  recoverMissedPlaybacks,
} from "../extension/history/playback-recovery.js";
import { YoutubeManager } from "../extension/sources/bg-youtube.js";
import { memoryHistory } from "./support/memory-history.js";

const minute = 60_000;
const start = new Date(2026, 10, 3, 22, 0).getTime();
const later = start + 60 * minute;
const row = (video, session, offset, overrides = {}) => ({
  snapshotId: `1:doc:${session}:${start + offset * minute}`,
  eventId: `playback:1:doc:${session}`,
  strIdent: video,
  strTitle: `Title ${video}`,
  minute: start + offset * minute,
  from: start + offset * minute,
  to: start + (offset + 1) * minute,
  milliseconds: minute,
  ...overrides,
});

function setup(initial = []) {
  const { provider, records } = memoryHistory(initial);
  const manager = new YoutubeManager();
  manager.setProviderFactory({ getCurrentProvider: () => provider });
  return { manager, records };
}

test("rows of one play become one watch at its first measured moment", () => {
  const plays = measuredPlaybacks(
    [row("aaaaaaaaaaa", "one", 2), row("aaaaaaaaaaa", "one", 1)],
    later,
  );
  assert.deepEqual(plays, [
    {
      videoId: "aaaaaaaaaaa",
      playbackId: "1:doc:one",
      title: "Title aaaaaaaaaaa",
      watchedAt: start + minute,
      end: start + 3 * minute,
    },
  ]);
});

test("a client's own event date wins, so a replayed snapshot cannot conflict", () => {
  const eventWatchedAt = start - 5 * minute;
  const [play] = measuredPlaybacks(
    [row("aaaaaaaaaaa", "one", 1, { eventWatchedAt })],
    later,
  );
  assert.equal(play.watchedAt, eventWatchedAt);
});

test("plays that may still be running or uploading are left alone", () => {
  const rows = [row("aaaaaaaaaaa", "one", 1)];
  const end = rows[0].to;
  assert.equal(measuredPlaybacks(rows, end + 9 * minute).length, 0);
  assert.equal(measuredPlaybacks(rows, end + 10 * minute).length, 1);
});

test("rows from other event schemes are ignored", () => {
  assert.deepEqual(
    measuredPlaybacks(
      [row("aaaaaaaaaaa", "one", 1, { eventId: "saved:other" })],
      later,
    ),
    [],
  );
});

test("missed plays are restored once with their real time, title and count", async () => {
  const { manager, records } = setup();
  const rows = [
    row("aaaaaaaaaaa", "one", 1),
    row("aaaaaaaaaaa", "two", 20),
    row("bbbbbbbbbbb", "three", 5),
  ];
  assert.deepEqual(await recoverMissedPlaybacks(manager, rows, later), {
    recoveredCount: 3,
  });
  assert.deepEqual(await recoverMissedPlaybacks(manager, rows, later), {
    recoveredCount: 0,
  });
  const video = records.get("aaaaaaaaaaa");
  assert.equal(video.intCount, 2);
  assert.equal(video.strTitle, "Title aaaaaaaaaaa");
  assert.equal(video.intTimestamp, start + 20 * minute);
  assert.deepEqual(
    video.watchEvents.map((event) => event.precision),
    ["exact", "exact"],
  );
  assert.equal(records.get("bbbbbbbbbbb").intCount, 1);
});

test("one failed recovery does not block the rest and is reported", async () => {
  const { manager, records } = setup();
  const recover = manager.recoverPlayback.bind(manager);
  manager.recoverPlayback = async (play) => {
    if (play.videoId === "aaaaaaaaaaa") throw new Error("Write failed");
    return recover(play);
  };
  await assert.rejects(
    recoverMissedPlaybacks(
      manager,
      [row("aaaaaaaaaaa", "one", 1), row("bbbbbbbbbbb", "two", 5)],
      later,
    ),
    /Could not recover 1 measured playbacks/,
  );
  assert.ok(records.has("bbbbbbbbbbb"));
});

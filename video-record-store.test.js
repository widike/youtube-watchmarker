import assert from "node:assert/strict";
import test from "node:test";
import { YoutubeManager } from "./bg-youtube.js";
import { memoryHistory } from "./test-support/memory-history.js";

function setup(existing = []) {
  const { provider, records } = memoryHistory(existing);
  const manager = new YoutubeManager();
  manager.setProviderFactory({ getCurrentProvider: () => provider });
  return { records, provider, manager };
}

test("lookup is ID-based regardless of punctuation, Unicode or changed titles", async () => {
  const { manager } = setup([
    {
      strIdent: "aaaaaaaaaaa",
      strTitle: "Grüße 😀 東京 &amp;",
      intTimestamp: 10,
      intCount: 4,
    },
  ]);
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 4);
  assert.equal(await manager.lookup("bbbbbbbbbbb"), null);
  await assert.rejects(manager.lookup("!!!!!!!!!!!"), /Invalid video ID/);
});

const play = (manager, id, title = "", playbackId = crypto.randomUUID()) =>
  manager.recordPlayback(id, title, playbackId);

test("each new playback increments once, even within the former cooldown", async () => {
  const { manager } = setup();
  assert.equal(
    (await play(manager, "aaaaaaaaaaa", "Ä 😀", "first")).intCount,
    1,
  );
  assert.equal(
    (await play(manager, "aaaaaaaaaaa", "Ä 😀", "second")).intCount,
    2,
  );
  assert.equal(
    (await play(manager, "aaaaaaaaaaa", "Updated title", "second")).intCount,
    2,
  );
  assert.equal(
    (await play(manager, "aaaaaaaaaaa", "Updated title")).intCount,
    3,
  );
});

test("simultaneous plays and metadata updates do not lose increments", async () => {
  const { manager } = setup();
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      play(manager, "aaaaaaaaaaa", "Title", `play:${Math.floor(i / 2)}`),
    ),
  );
  assert.equal((await manager.lookup("aaaaaaaaaaa")).intCount, 10);
});

test("importing source records during playback preserves counts and timestamps", async (t) => {
  t.mock.method(Date, "now", () => 200);
  const { manager, provider } = setup([
    {
      strIdent: "aaaaaaaaaaa",
      intTimestamp: 100,
      strTitle: "Old",
      intCount: 4,
    },
  ]);
  await Promise.all([
    play(manager, "aaaaaaaaaaa", "新", "play"),
    manager.upsertSourceVideo(provider, {
      strIdent: "aaaaaaaaaaa",
      strTitle: "新",
      intTimestamp: null,
      intCount: 1,
    }),
    play(manager, "aaaaaaaaaaa", "YouTube", "play"),
  ]);
  assert.deepEqual(await manager.lookup("aaaaaaaaaaa"), {
    strIdent: "aaaaaaaaaaa",
    intTimestamp: 200,
    strTitle: "新",
    intCount: 5,
  });
});

test("failed writes can retry and malformed stored counts do not concatenate", async () => {
  const { manager, provider } = setup([
    {
      strIdent: "aaaaaaaaaaa",
      strTitle: "Title",
      intTimestamp: 1,
      intCount: "4",
    },
  ]);
  const write = provider.recordPlayback;
  provider.recordPlayback = async () => {
    throw new Error("Failed write");
  };
  await assert.rejects(play(manager, "aaaaaaaaaaa"), /Failed write/);
  provider.recordPlayback = write;
  assert.equal((await play(manager, "aaaaaaaaaaa")).intCount, 5);
});

test("single-character and bracketed international titles are meaningful", async () => {
  const { manager } = setup();
  assert.equal((await play(manager, "aaaaaaaaaaa", "猫")).strTitle, "猫");
  assert.equal(
    (await play(manager, "bbbbbbbbbbb", "[東京]")).strTitle,
    "[東京]",
  );
});

test("replaying an unavailable video preserves its saved title", async (t) => {
  t.mock.method(Date, "now", () => 200);
  for (const title of ["- YouTube", "Deleted video - YouTube", "youtube"]) {
    const { manager } = setup([
      {
        strIdent: "aaaaaaaaaaa",
        strTitle: "Original title 😀",
        intTimestamp: 100,
        intCount: 4,
      },
    ]);
    const video = await play(manager, "aaaaaaaaaaa", title, "replay");
    assert.equal(video.strTitle, "Original title 😀", title);
    assert.equal(video.intTimestamp, 200);
    assert.equal(video.intCount, 5);
  }
});

test("YouTube source imports preserve titles when a video becomes unavailable", async () => {
  for (const title of ["- YouTube", "[deleted video]", "Gelöschtes Video"]) {
    const { manager, provider } = setup([
      {
        strIdent: "aaaaaaaaaaa",
        strTitle: "Original title",
        intTimestamp: 100,
        intCount: 4,
      },
    ]);
    await manager.upsertSourceVideo(provider, {
      strIdent: "aaaaaaaaaaa",
      strTitle: title,
      intTimestamp: 200,
      intCount: 1,
    });
    const video = await manager.lookup("aaaaaaaaaaa");
    assert.equal(video.strTitle, "Original title", title);
    assert.equal(video.intTimestamp, 200);
  }
});

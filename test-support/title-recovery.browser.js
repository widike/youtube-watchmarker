import { repairVideoTitle } from "../history-title-storage.js";
import { saveVideos, pendingVideos, deleteVideo } from "../history-storage.js";
import { readVideos } from "../history-event-storage.js";
import { recordPlayback } from "../history-playback.js";

const id = "aaaaaaaaaaa";
const original = { strIdent: id, strTitle: "", intTimestamp: 100, intCount: 4 };

export async function testTitleRecovery({ test, database, assert }) {
  await test("title repair retains dates, counts and events and queues the repaired record", async () => {
    const db = await database();
    await saveVideos(db, [original]);
    const before = await readVideos(db, { id });
    assert(
      (await repairVideoTitle(db, id, "Grüße 😀")) === "Grüße 😀",
      "Title not repaired",
    );
    const after = await readVideos(db, { id });
    assert(
      JSON.stringify(after) ===
        JSON.stringify({ ...before, strTitle: "Grüße 😀" }),
      "Repair changed history",
    );
    const queued = (await pendingVideos(db))[0].video;
    assert(
      JSON.stringify(queued) === JSON.stringify(after),
      "Repair not queued with current events",
    );
  });

  await test("an intervening playback title wins over recovery", async () => {
    const db = await database();
    await saveVideos(db, [original]);
    await recordPlayback(db, id, "New player title", "session");
    const before = await readVideos(db, { id });
    assert(
      (await repairVideoTitle(db, id, "Stale history title")) ===
        "New player title",
      "Replaced a good title",
    );
    assert(
      JSON.stringify(await readVideos(db, { id })) === JSON.stringify(before),
      "Playback changed",
    );
  });

  await test("recovery cannot resurrect deleted history or create an unwatched video", async () => {
    const db = await database();
    assert(
      (await repairVideoTitle(db, id, "Title")) === "",
      "Created an unwatched video",
    );
    await saveVideos(db, [original]);
    await deleteVideo(db, id);
    const before = await readVideos(db, { id });
    assert(
      (await repairVideoTitle(db, id, "Title")) === "",
      "Repaired a deletion",
    );
    assert(
      JSON.stringify(await readVideos(db, { id })) === JSON.stringify(before),
      "Changed deletion marker",
    );
  });
}

const PLAYBACK = "playback:";
// Replicated rows and their events travel in one sync. Leave a live play and a
// partly uploaded one alone so every device derives the same event.
const SETTLED_MILLISECONDS = 10 * 60_000;

// Time rows exist only for plays that reached a minute, so one without a saved
// event is a watch that was measured but never recorded.
export function measuredPlaybacks(rows, now = Date.now()) {
  const plays = new Map();
  for (const row of rows) {
    if (!row.eventId.startsWith(PLAYBACK)) continue;
    const play = plays.get(row.eventId) || {
      videoId: row.strIdent,
      playbackId: row.eventId.slice(PLAYBACK.length),
      title: "",
      watchedAt: row.eventWatchedAt ?? row.from,
      end: row.to,
    };
    play.title ||= row.strTitle;
    play.watchedAt = Math.min(play.watchedAt, row.eventWatchedAt ?? row.from);
    play.end = Math.max(play.end, row.to);
    plays.set(row.eventId, play);
  }
  return [...plays.values()].filter(
    (play) => play.end <= now - SETTLED_MILLISECONDS,
  );
}

export async function recoverMissedPlaybacks(manager, rows, now = Date.now()) {
  let recoveredCount = 0;
  let failedCount = 0;
  for (const play of measuredPlaybacks(rows, now)) {
    try {
      if (await manager.recoverPlayback(play)) recoveredCount++;
    } catch {
      failedCount++;
    }
  }
  if (failedCount)
    throw new Error(`Could not recover ${failedCount} measured playbacks`);
  return { recoveredCount };
}

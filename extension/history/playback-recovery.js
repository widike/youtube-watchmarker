const PLAYBACK = "playback:";
// Replicated rows and their events travel in one sync. Leave a live play and a
// partly uploaded one alone so every device derives the same event.
const SETTLED_MILLISECONDS = 10 * 60_000;

// Time rows exist only for plays that reached a minute, so one without a saved
// event is a watch that was measured but never recorded.
export function measuredPlaybacks(rows, now = Date.now()) {
  const plays = new Map();
  for (const row of rows) {
    if (!row.eventId.startsWith(PLAYBACK) || !row.eventWatchedAt) continue;
    const key = `${row.strIdent}:${row.eventId}`;
    const play = plays.get(key) || {
      videoId: row.strIdent,
      playbackId: row.eventId.slice(PLAYBACK.length),
      title: "",
      watchedAt: row.eventWatchedAt,
      observedDeletion: row.observedDeletion || 0,
      end: row.to,
    };
    play.title ||= row.strTitle;
    play.conflicting ||=
      play.watchedAt !== row.eventWatchedAt ||
      play.observedDeletion !== (row.observedDeletion || 0);
    play.end = Math.max(play.end, row.to);
    plays.set(key, play);
  }
  return [...plays.values()]
    .filter(
      (play) => !play.conflicting && play.end <= now - SETTLED_MILLISECONDS,
    )
    .map(({ conflicting: _conflicting, ...play }) => play);
}

export async function recoverMissedPlaybacks(manager, rows, now = Date.now()) {
  let recoveredCount = 0;
  let failedCount = 0;
  const plays = measuredPlaybacks(rows, now);
  for (let offset = 0; offset < plays.length; offset += 500) {
    const batch = plays.slice(offset, offset + 500);
    const known = await manager.getProvider().knownPlaybackEvents(batch);
    for (const [index, play] of batch.entries()) {
      if (known[index]) continue;
      try {
        if (await manager.recoverPlayback(play)) recoveredCount++;
      } catch {
        failedCount++;
      }
    }
  }
  if (failedCount)
    throw new Error(`Could not recover ${failedCount} measured playbacks`);
  return { recoveredCount };
}

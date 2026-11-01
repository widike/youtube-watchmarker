// Match measured playback by immutable session identity, never by date or title.
export function enrichHistoryVideos(
  videos,
  measured,
  durations,
  now = Date.now(),
) {
  const lengths = new Map(
    durations
      .filter((row) => row.expiresAt > now && row.seconds > 0)
      .map((row) => [row.strIdent, row.seconds]),
  );
  const sessions = new Map();
  for (const row of measured) {
    if (row.to > now || !(row.milliseconds > 0)) continue;
    const key = `${row.strIdent}:${row.eventId}`;
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(row);
    if (row.durationSeconds > 0) lengths.set(row.strIdent, row.durationSeconds);
  }
  return videos.map((video) => {
    const rows = sessions.get(video.entryId) || [];
    const durationSeconds = lengths.get(video.strIdent);
    const watchedMilliseconds = rows.reduce(
      (sum, row) => sum + row.milliseconds,
      0,
    );
    const ranges = rows
      .flatMap((row) => row.mediaRanges || [])
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = 0;
    for (const [from, to] of ranges) {
      covered += Math.max(
        0,
        Math.min(to, durationSeconds) - Math.max(from, end),
      );
      end = Math.max(end, to);
    }
    // Older measurements and imports cannot establish actual video coverage.
    const complete =
      rows.length && rows.every((row) => row.mediaRanges?.length);
    return {
      ...video,
      ...(durationSeconds > 0 ? { durationSeconds } : {}),
      ...(watchedMilliseconds > 0 ? { watchedMilliseconds } : {}),
      ...(durationSeconds > 0 && complete
        ? { watchedPercent: Math.min(100, (covered / durationSeconds) * 100) }
        : {}),
    };
  });
}

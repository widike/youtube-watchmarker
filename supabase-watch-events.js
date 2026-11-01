const TABLE = "/youtube_watch_events";
const quote = (value) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export async function uploadWatchEvents(provider, videos) {
  const events = videos.flatMap((video) =>
    video.watchEvents.map((event) => ({
      str_ident: video.strIdent,
      event_id: event.eventId,
      watched_at: event.watchedAt,
      source: event.source,
      precision: event.precision,
      observed_deletion: event.observedDeletion,
    })),
  );
  for (let i = 0; i < events.length; i += 100) {
    await provider.makeRequest(
      "POST",
      `${TABLE}?on_conflict=user_id,str_ident,event_id`,
      events.slice(i, i + 100),
      "resolution=ignore-duplicates,return=minimal",
    );
  }
}

export async function downloadWatchEvents(provider, videos) {
  if (!videos.length) return videos;
  const byId = new Map(
    videos.map((video) => [video.strIdent, { ...video, watchEvents: [] }]),
  );
  const quoted = videos.map(({ strIdent }) => quote(strIdent));
  let after = "";
  for (;;) {
    const params = new URLSearchParams({
      select:
        "str_ident,event_id,watched_at,source,precision,observed_deletion",
      str_ident: `in.(${quoted.join(",")})`,
      order: "event_id.asc,str_ident.asc",
      limit: "500",
    });
    // IDs include the video identity; still use a compound cursor so imported
    // playback IDs reused for different videos cannot skip a boundary row.
    if (after)
      params.set(
        "or",
        `(event_id.gt.${quote(after.eventId)},and(event_id.eq.${quote(after.eventId)},str_ident.gt.${quote(after.strIdent)}))`,
      );
    const response = await provider.makeRequest("GET", `${TABLE}?${params}`);
    const rows = await response.json();
    if (!rows.length) return [...byId.values()];
    for (const row of rows)
      byId.get(row.str_ident)?.watchEvents.push({
        eventId: row.event_id,
        watchedAt: Number(row.watched_at),
        source: row.source,
        precision: row.precision,
        observedDeletion: Number(row.observed_deletion) || 0,
      });
    after = { eventId: rows.at(-1).event_id, strIdent: rows.at(-1).str_ident };
  }
}

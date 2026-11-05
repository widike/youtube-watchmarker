import { getSyncPage } from "./supabase-sync-pages.js";
import { normalizeWatchTime } from "../history/watch-time-records.js";

const TABLE = "/youtube_watch_time";
export function timeToRow(time) {
  const row = normalizeWatchTime(time);
  return {
    snapshot_id: row.snapshotId,
    event_id: row.eventId,
    str_ident: row.strIdent,
    str_title: row.strTitle,
    minute_at: row.minute,
    from_at: row.from,
    to_at: row.to,
    milliseconds: row.milliseconds,
    observed_deletion: row.observedDeletion,
    event_watched_at: row.eventWatchedAt ?? null,
    duration_seconds: row.durationSeconds ?? null,
    media_ranges: row.mediaRanges ?? [],
  };
}
export function timeFromRow(row) {
  return normalizeWatchTime({
    snapshotId: row.snapshot_id,
    eventId: row.event_id,
    strIdent: row.str_ident,
    strTitle: row.str_title,
    minute: Number(row.minute_at),
    from: Number(row.from_at),
    to: Number(row.to_at),
    milliseconds: Number(row.milliseconds),
    observedDeletion: Number(row.observed_deletion) || 0,
    ...(row.event_watched_at != null
      ? { eventWatchedAt: Number(row.event_watched_at) }
      : {}),
    ...(row.duration_seconds != null
      ? {
          durationSeconds: Number(row.duration_seconds),
          mediaRanges: row.media_ranges,
        }
      : {}),
  });
}
export async function uploadWatchTime(provider, rows) {
  for (let offset = 0; offset < rows.length; offset += 100)
    await provider.makeRequest(
      "POST",
      `${TABLE}?on_conflict=user_id,snapshot_id`,
      rows.slice(offset, offset + 100).map(timeToRow),
    );
  return true;
}
export async function downloadWatchTime(provider, after, limit, window) {
  return (await getSyncPage(provider, "watchTime", after, limit, window)).map(
    timeFromRow,
  );
}

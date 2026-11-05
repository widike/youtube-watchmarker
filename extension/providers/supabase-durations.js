import { getSyncPage } from "./supabase-sync-pages.js";
import { normalizeDuration } from "../duration/duration-records.js";

const TABLE = "/youtube_video_durations";
export function durationToRow(value) {
  const row = normalizeDuration(value);
  return {
    str_ident: row.strIdent,
    seconds: row.seconds,
    fetched_at: row.fetchedAt,
    expires_at: row.expiresAt ?? null,
    unavailable: row.unavailable === true,
  };
}
export function durationFromRow(row) {
  return normalizeDuration({
    strIdent: row.str_ident,
    seconds: row.seconds === null ? null : Number(row.seconds),
    fetchedAt: Number(row.fetched_at),
    ...(row.unavailable === true
      ? { unavailable: true }
      : { expiresAt: Number(row.expires_at) }),
  });
}
export async function uploadDurations(provider, rows) {
  for (let offset = 0; offset < rows.length; offset += 100)
    await provider.makeRequest(
      "POST",
      `${TABLE}?on_conflict=user_id,str_ident`,
      rows.slice(offset, offset + 100).map(durationToRow),
    );
  return true;
}
export async function downloadDurations(provider, after, limit, window) {
  return (await getSyncPage(provider, "durations", after, limit, window)).map(
    durationFromRow,
  );
}

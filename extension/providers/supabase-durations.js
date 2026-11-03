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
export async function downloadDurations(provider, after = "", limit = 500) {
  // Remove expired API metadata in the cloud as well as on each installation.
  if (!after)
    await provider.makeRequest(
      "DELETE",
      `${TABLE}?expires_at=lte.${Date.now()}`,
    );
  const params = new URLSearchParams({
    select: "str_ident,seconds,fetched_at,expires_at,unavailable",
    order: "str_ident.asc",
    limit: String(limit),
    or: `(unavailable.eq.true,expires_at.gt.${Date.now()})`,
  });
  if (after) params.set("str_ident", `gt.${after}`);
  return (
    await (await provider.makeRequest("GET", `${TABLE}?${params}`)).json()
  ).map(durationFromRow);
}

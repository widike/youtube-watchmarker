import { normalizeBlock } from "../shared/blocked-video-records.js";

const TABLE = "/youtube_blocked_videos";

export async function uploadBlockedVideos(provider, records) {
  const rows = records.map(normalizeBlock).map((row) => ({
    str_ident: row.videoId,
    title: row.title,
    blocked: row.blocked,
    updated_at: row.updatedAt,
    change_id: row.changeId,
  }));
  for (let offset = 0; offset < rows.length; offset += 100)
    await provider.makeRequest(
      "POST",
      `${TABLE}?on_conflict=user_id,str_ident`,
      rows.slice(offset, offset + 100),
    );
  return true;
}

export async function downloadBlockedVideos(provider, after = "", limit = 500) {
  const params = new URLSearchParams({
    select: "str_ident,title,blocked,updated_at,change_id",
    order: "str_ident.asc",
    limit: String(limit),
  });
  if (after) params.set("str_ident", `gt.${after}`);
  const response = await provider.makeRequest("GET", `${TABLE}?${params}`);
  return (await response.json()).map((row) =>
    normalizeBlock({
      videoId: row.str_ident,
      title: row.title,
      blocked: row.blocked,
      updatedAt: Number(row.updated_at),
      changeId: row.change_id,
    }),
  );
}

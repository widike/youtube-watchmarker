import { getSyncPage } from "./supabase-sync-pages.js";
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

export async function downloadBlockedVideos(provider, after, limit, window) {
  return (await getSyncPage(provider, "blocked", after, limit, window)).map(
    (row) =>
      normalizeBlock({
        videoId: row.str_ident,
        title: row.title,
        blocked: row.blocked,
        updatedAt: Number(row.updated_at),
        changeId: row.change_id,
      }),
  );
}

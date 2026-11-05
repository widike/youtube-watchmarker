import { credentialStorage } from "./credential-storage.js";
import { supabaseAuthClient } from "./supabase-auth-client.js";
import { mergeVideoData, normalizeVideo } from "../history/history-records.js";
import {
  uploadWatchEvents,
  downloadWatchEvents,
} from "./supabase-watch-events.js";

import { uploadWatchTime, downloadWatchTime } from "./supabase-watch-time.js";
import { uploadDurations, downloadDurations } from "./supabase-durations.js";
import {
  uploadBlockedVideos,
  downloadBlockedVideos,
} from "./supabase-blocked-videos.js";

const TABLE = "/youtube_watch_history";
const COLUMNS =
  "str_ident,int_timestamp,str_title,int_count,int_deleted_at,int_imported_count";

function fromRow(row) {
  return {
    strIdent: row.str_ident,
    intTimestamp: Number(row.int_timestamp),
    strTitle: row.str_title || "",
    intCount: Number(row.int_count) || 1,
    intDeletedAt: Number(row.int_deleted_at) || 0,
    intImportedCount: Number(row.int_imported_count) || 0,
  };
}

// Small authenticated PostgREST adapter. Retry obligations live in IndexedDB,
// never in timers, swallowed HTTP errors, or memory-only connection flags.
export class SupabaseDatabaseProvider {
  constructor() {
    this.isConnected = false;
  }

  async makeRequest(
    method,
    path,
    body,
    prefer = "resolution=merge-duplicates,return=minimal",
  ) {
    const configuration = await credentialStorage.getConfiguration();
    if (!configuration) throw new Error("Connect this device to sync first.");
    let token = await supabaseAuthClient.getAccessToken();
    const send = () =>
      fetch(`${configuration.supabaseUrl}/rest/v1${path}`, {
        method,
        headers: {
          apikey: configuration.publishableKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: prefer,
          "Cache-Control": "no-cache",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    let response = await send();
    if (response.status === 401) {
      token = (await supabaseAuthClient.refreshSession()).accessToken;
      response = await send();
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(
        payload.message || `Sync service returned HTTP ${response.status}`,
      );
    }
    return response;
  }

  async init() {
    const status = await this.checkTableStatus();
    if (!status.exists) throw new Error(status.error);
    this.isConnected = true;
    return true;
  }

  async checkTableStatus() {
    try {
      const response = await this.makeRequest(
        "POST",
        "/rpc/watchmarker_sync_version",
        {},
      );
      if ((await response.json()) !== 4)
        throw new Error("Unsupported sync schema");
      await this.makeRequest(
        "GET",
        "/youtube_video_durations?select=str_ident&limit=0",
      );
      await this.makeRequest(
        "GET",
        "/youtube_blocked_videos?select=str_ident&limit=0",
      );
      if (
        (await (
          await this.makeRequest(
            "POST",
            "/rpc/watchmarker_event_merge_version",
            {},
          )
        ).json()) !== 1
      )
        throw new Error("Watch-event precision setup is missing");
      return { exists: true };
    } catch (error) {
      return {
        exists: false,
        error: `Sync setup needs attention: ${error.message}. Open Connection settings for the database setup.`,
      };
    }
  }

  async testConnection() {
    return this.init();
  }
  async checkTableExists() {
    return (await this.checkTableStatus()).exists;
  }
  async close() {
    this.isConnected = false;
  }

  async importVideos(videos) {
    if (!videos.length) return true;
    // Deduplicate within a batch before Postgres ON CONFLICT sees it.
    const records = mergeVideoData(videos);
    const rows = records.map((video) => ({
      str_ident: video.strIdent,
      int_timestamp: video.intTimestamp,
      str_title: video.strTitle,
      int_count: video.intCount,
      int_deleted_at: video.intDeletedAt,
      int_imported_count: video.intImportedCount,
    }));
    await this.makeRequest(
      "POST",
      `${TABLE}?on_conflict=user_id,str_ident`,
      rows,
    );
    // The outbox is acknowledged only after both summary and events succeed.
    // A failed second request is retried with the same immutable event IDs.
    await uploadWatchEvents(this, records);
    return true;
  }

  async importWatchTime(rows) {
    return uploadWatchTime(this, rows);
  }
  async importBlockedVideos(rows) {
    return uploadBlockedVideos(this, rows);
  }
  async getBlockedVideoPage(after = "", limit = 500) {
    return downloadBlockedVideos(this, after, limit);
  }
  async importDurations(rows) {
    return uploadDurations(this, rows);
  }
  async getDurationPage(after = "", limit = 500) {
    return downloadDurations(this, after, limit);
  }
  async getWatchTimePage(after = "", limit = 500) {
    return downloadWatchTime(this, after, limit);
  }

  async putVideo(video) {
    return this.importVideos([video]);
  }

  async getVideoPage(after = "", limit = 500) {
    const cursor = after ? `&str_ident=gt.${encodeURIComponent(after)}` : "";
    const response = await this.makeRequest(
      "GET",
      `${TABLE}?select=${COLUMNS}&order=str_ident.asc&limit=${limit}${cursor}`,
    );
    const rows = (await response.json()).map(fromRow);
    return (await downloadWatchEvents(this, rows)).map(normalizeVideo);
  }

  async getAllVideos() {
    const videos = [];
    let after = "";
    for (;;) {
      const rows = await this.getVideoPage(after);
      if (!rows.length) return videos;
      videos.push(...rows);
      after = rows.at(-1).strIdent;
    }
  }
}

export const supabaseDatabaseProvider = new SupabaseDatabaseProvider();

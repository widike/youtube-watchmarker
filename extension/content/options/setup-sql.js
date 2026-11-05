// Only additive, data-preserving migrations belong in the copied setup.
// The historical archive/reset migrations must never be included here.
const MIGRATIONS = [
  "20261101000000_durable_history_sync.sql",
  "20261101010000_watch_events.sql",
  "20261101020000_device_linking.sql",
  "20261101030000_import_reconciliation.sql",
  "20261101040000_playback_time_sync.sql",
  "20261101050000_anonymous_access_hardening.sql",
  "20261101060000_captcha_configuration.sql",
  "20261101070000_short_connection_codes.sql",
  "20261103000000_video_duration_sync.sql",
  "20261103010000_watch_event_precision.sql",
  "20261105000000_blocked_video_sync.sql",
  "20261105010000_incremental_sync.sql",
];

export async function loadSetupSql() {
  const bodies = await Promise.all(
    MIGRATIONS.map(async (name) => {
      const response = await fetch(
        chrome.runtime.getURL(`supabase/migrations/${name}`),
      );
      if (!response.ok)
        throw new Error("Database setup SQL could not be loaded");
      const sql = await response.text();
      const transaction = sql.trim().match(/^begin;\s*([\s\S]*?)\s*commit;$/i);
      if (!transaction)
        throw new Error(
          `Database setup SQL has an invalid transaction: ${name}`,
        );
      // All schema/policy updates become visible together. An error rolls back
      // the entire setup, and PostgREST reloads only after a successful commit.
      return `-- ${name}\n${transaction[1].replace(/^notify pgrst, 'reload schema';\s*$/gm, "").trim()}`;
    }),
  );
  return [
    "-- Safe to rerun: preserves existing history, device links and settings.",
    "begin;",
    ...bodies,
    "notify pgrst, 'reload schema';",
    "commit;",
  ].join("\n\n");
}

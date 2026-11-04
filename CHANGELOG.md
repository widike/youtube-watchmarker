# Changelog

## 1.3.1 — 2026-11-03

The existing 1.3.1 package was updated on 2026-11-04 with playback tracking and
YouTube history-import fixes.

- Videos reached without a page load (clicks inside YouTube, autoplay) are recorded
  again. The check compared them to `sender.url`, which Chrome freezes at the
  document's first URL, so each one was rejected as an invalid watch event.
- YouTube history reads weekday section headers, so the past week is no longer
  treated as undated until YouTube shows a full date.
- Periodic sync restores plays whose measured time was saved without a watch, with
  their real time, after downloading from other devices.
- YouTube history adds missing videos after the import boundary when YouTube's own
  resume position proves at least a minute. **Check sources** counts them as new.

- Cloud sync resolves the authenticated device's actual shared-history membership.
  A repaired device that previously created its own history adopts its linked
  history, resets old download cursors and republishes retained local records.
  Other owners and projects remain isolated; refreshed credentials are preserved.
- Date-only and inferred imports of the same watch merge without aborting a
  restore or inventing a clock time. Event identities and timestamps remain immutable.
- **Sync now** continues through partial restore batches; **Sync all** also
  synchronizes Supabase. History cards and totals refresh as cloud records arrive,
  preserving loaded pages and the visible video. Grid watch times remain readable.
- **Create new history** identifies first-device setup explicitly. Other devices
  must use a connection code to join the same history.

Apply `20261103010000_watch_event_precision.sql` to an existing Supabase project
and update both Macs. **Copy setup SQL** includes the migration. An administrator
can repair an accidentally separate history with
`supabase/admin/reconnect-history.sql` after reviewing both owner identities;
the script retains the original rows and a private recovery audit.

## 1.3.0 — 2026-11-02

History and viewing-time fixes, clearer popup layouts, and an organized extension
package with local development configuration excluded.

- Video deletion completes across local history, Supabase and the signed-in
  YouTube account, including older history pages. Pending remote deletions retry
  after failures and restarts; deletion markers prevent stale devices restoring
  entries. Saved records remain behind those markers.
- Missing titles are recovered from browser history without creating watch events.
  Playback handles delayed titles and ignores loading labels.
- Historical viewing estimates stop at the next timestamped video, with limits for
  video length, elapsed time and the selected period. Average-week charts retain
  imported records with known hours without inventing hours for date-only records.
- Browser and YouTube imports respect the installation's saved tracking boundary,
  preventing newer visits from bypassing the one-minute playback requirement.
  Existing saved history is retained.
- Hover previews, audio and other unrelated media events no longer interrupt
  watch-time tracking for the main video or prevent its one-minute threshold
  from being reached. Ad interruptions still pause measured playback correctly.
- Repeated watches on the same day share a card while preserving individual play
  details. Duration badges refresh without losing loaded history or scroll position.
  Missing lengths wake idle backfill while preserving pause, retry and quota limits;
  unfinished live-video lengths are retried.
- Cached video lengths and unavailable-video markers now sync across devices.
  Existing valid caches upload automatically; receiving devices display durations
  without a YouTube API key. Keys, backfill controls and quota budgets stay local.
  Interrupted transfers retry, and newer fetches replace older cache entries.
- Popup statistics have clearer periods, thumbnail duration overlays and playback
  progress, including in forced colors. Single views omit the redundant “×1” badge.
- History starts loading before settings panels, sidebar counts and statistics.
  Popup totals avoid dashboard-only analysis, and video counts read stored
  summaries without loading every watch event.
- Watched marking and appearance settings apply to YouTube's modern end-screen
  recommendation cards, including in fullscreen.
- Runtime code is grouped by responsibility under `extension/`; tests and fixtures
  live under `tests/`. Build checks validate manifest, module and asset paths.
- Release ZIPs contain the installable extension and licenses. Machine-specific
  `.mcp.json`, `.codex/`, credentials and generated development output stay local.

The 1.3.0 package was updated on 2026-11-03 with playback tracking, modern
end-screen marking, initial history-loading fixes and cross-device duration-cache
sync.

For a release ZIP, extract it into the existing extension installation folder,
reload at `chrome://extensions`, and refresh YouTube tabs. For a source checkout,
run `npm ci` and `npm run build`, then select `extension/` using **Load unpacked**.
The extension's public identity key is unchanged. Existing Supabase projects must
apply `supabase/migrations/20261103000000_video_duration_sync.sql` for duration-cache
sync. **Copy setup SQL** includes this migration. Reload the updated extension on
each device and use **Sync now** on the device holding the cache, then on receiving
devices. Local history and measured playback are preserved.

[Full changelog](https://github.com/widike/youtube-watchmarker/compare/v1.2.0...v1.3.0)

## 1.2.0 — 2026-11-01

This release updates the extension from 1.0.5 with a rebuilt local-first history,
viewing insights, and shared history across computers and SmartTube.

### Major improvements

- **Individual watches and accurate playback tracking.** Rewatches now keep
  their own dated entries instead of replacing earlier dates. Live playback
  requires a minute of measured viewing before it marks a video; pauses, seeks,
  stalls and sleep do not inflate measured time. YouTube's history page stays
  free of Watchmarker marks.
- **Viewing insights.** The popup and dashboard show viewing hours, activity
  timelines, average-week and annual calendar heatmaps, streaks, popular title
  words and most-recorded videos. Rolling periods and comparisons make changes
  easier to see. English and German word families group related title terms.
- **Calendar activity stays visible without durations.** Each day uses viewing
  time when available and activity counts otherwise, including older history
  and gaps after time tracking began. The shared legend explains both scales;
  tooltips and keyboard details show the exact values and partial totals.
- **Durable cross-device sync.** Local recording works offline. Pending uploads,
  playback receipts and restoration progress survive service-worker and browser
  restarts. Linked computers and updated SmartTube clients share watch events,
  deletion markers and measured playback time without duplicating retries.
- **Simpler device setup.** Connect another device with a six-letter code that
  expires after ten minutes and can link one device. SmartTube supports entry
  and secure verification directly in **Settings → Extensions → Cloud sync**.
  Sync status and recovery guidance explain pending work and connection issues.
- **Optional historical duration estimates.** Backfill older video lengths using
  your YouTube Data API key. Estimates are labeled separately from measured time.
  Background work resumes after restarts, respects quota and retry limits, and
  skips unavailable videos. Save, resume, pause and cache-removal actions are
  explicit.
- **Safer imports and reconciliation.** Browser history, YouTube history and
  liked-video imports avoid redundant observations. Preview and approve a
  resumable reconciliation batch to correct older overlapping imports while
  retaining original events and legitimate playback sessions. JSON backups
  preserve watch events and deletion markers.
- **Faster, clearer history browsing.** Popup and library lists scroll
  continuously with bounded rendering for large histories. Redesigned settings,
  search, light/dark themes and keyboard-accessible charts improve daily use.
- **Stronger security and maintainability.** Device-specific anonymous Auth,
  owner-scoped database policies, encrypted local refresh tokens, Turnstile
  verification and stricter extension-message validation protect shared history.
  The modular Manifest V3 runtime bundles its dependencies locally.

### Installation and upgrade

1. Download `youtube-watchmarker-1.2.0.zip` from this release, extract it, and load
   the extracted folder using **Load unpacked** at `chrome://extensions`.
   Chrome 126 or newer is required. Existing unpacked installations can update
   their current folder and reload the extension; refresh open YouTube tabs.
2. Export a history backup before upgrading. Local databases migrate on reload;
   preserved older counters cannot recover watch dates that were never stored.
   Keep the existing connected device session when available.
3. For cloud sync, apply the current setup SQL from **Sync & data → Copy setup
   SQL** to your Supabase project. Install all eight November 2026 source
   migrations in order and configure anonymous Auth and Turnstile as described
   in [the setup guide](https://github.com/widike/youtube-watchmarker#connect-your-devices).
   Update every linked extension and SmartTube client for sync contract 4.
   Old clients and old long connection codes are no longer supported.
4. Video-array JSON backups do not contain measured playback-time snapshots or
   the optional duration cache. Cloud restoration recovers synced measurements;
   keep a connected device available to pair a replacement.

Development requires Node 26.12.1 or newer. The dependency build, ESLint,
Prettier and all 319 Node/Chrome regression tests passed locally with no skipped
tests. The production dependency audit reports no vulnerabilities; six existing
development-tool dependency findings remain outside the packaged extension.
Local fixtures do not establish acceptance against live YouTube, production
Supabase or a physical TV.

[Full changelog](https://github.com/widike/youtube-watchmarker/compare/v1.0.5...v1.2.0)

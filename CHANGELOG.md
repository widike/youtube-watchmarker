# Changelog

## 1.2.2 — 2026-11-02

A maintenance release for video deletion, history metadata and popup fixes.

- The trash action now completes deletion across local history, Supabase and
  the signed-in YouTube account, including older YouTube history pages.
  Pending remote deletions retry automatically after failures or restarts,
  with clearer status and protection against stale devices restoring entries.
  Saved records remain behind deletion markers; this is not a permanent purge.
- Missing video titles are recovered from browser history without creating new
  watch events. Playback also handles delayed titles and ignores loading labels.
- History duration badges refresh automatically without losing loaded pages or
  scroll position. Displaying videos with missing lengths wakes idle backfill
  while preserving pause, retry and quota limits.
- The popup uses clearer statistics cards, overlays video lengths on thumbnails,
  and keeps playback progress within each thumbnail, including in forced colors.
- Watched badges show a count only for repeat watches; single views omit “×1”.

Update the existing extension folder, reload it at `chrome://extensions`, and
refresh open YouTube tabs. No additional database migration is required from 1.2.1.
If you installed the earlier 1.2.2 package, replace it with the rebuilt ZIP and reload.

[Full changelog](https://github.com/widike/youtube-watchmarker/compare/v1.2.1...v1.2.2)

## 1.2.1 — 2026-11-02

A small maintenance release with today's viewing-history and display fixes.

- Historical viewing estimates now stop at the next timestamped video start,
  with limits for video length, elapsed time and the selected period.
- The average-week chart includes imported records with known hours and keeps
  consistent activity units. Date-only records do not invent hourly activity.
- Browser and YouTube history imports only backfill dates before the installation's
  saved tracking boundary, preventing newer visits from bypassing the one-minute
  playback requirement. Existing saved history is retained.
- Repeated watches of a video on the same day share one card while retaining
  individual play details, with clearer separators and improved layout.
- Unfinished live-video durations are retried instead of cached as final lengths.

Update the existing extension folder, reload it at `chrome://extensions`, and
refresh open YouTube tabs. No additional database migration is required from 1.2.0.

[Full changelog](https://github.com/widike/youtube-watchmarker/compare/v1.2.0...v1.2.1)

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

# YouTube Watchmarker Reloaded

Development and tests require Node 26.12.1 or newer. `.node-version` pins the patched development runtime, and npm rejects older versions during dependency installation.

YouTube keeps track of your watch history and automatically marks videos that you have already watched. However, they only mark recently seen videos, which is kind of disappointing. This extension fixes this issue and keeps track of your entire watch history, such that not only the recently seen videos are being marked.

## Installation

Download `youtube-watchmarker-1.3.1.zip` from the
[latest GitHub release](https://github.com/widike/youtube-watchmarker/releases/latest),
extract it, and select the extracted folder using **Load unpacked** at
`chrome://extensions` in Chrome 126 or newer. You can also load the repository
by running `npm ci` and `npm run build`, then selecting the `extension/` folder
with **Load unpacked**. Keep the extracted folder for future Chrome sessions.
Reload the extension and refresh existing YouTube tabs after updating.

See [the changelog](CHANGELOG.md) for the major improvements and cloud-sync
upgrade requirements.

## Current Features

### Core Functionality

- **Complete Watch History Tracking**: Marks all previously watched videos, not just recent ones
- **Multiple Data Sources**: Integrates browser history, YouTube watch history, and liked videos
- **Real-time Detection**: Automatically detects when videos are watched through multiple methods
- **Individual Watch Events**: Rewatching a video adds a timestamped history entry; earlier watches stay in the timeline
- **Search & Management**: Built-in search functionality to find and manage your watch history
- **Video Management**: Delete individual videos from your watch history

### Visual Customization

- **Fade Out**: Reduce opacity of watched video thumbnails
- **Grayscale**: Convert watched video thumbnails to grayscale
- **Watch Badge**: Display "WATCHED" badge on marked videos
- **Watch Date**: Show the date when video was watched in the badge
- **Hide Progress Bar**: Hide YouTube's default progress bars on watched videos
- **Video Blocking**: Enable **Preferences → Local video blocking → Hide unwanted videos** to add an X beside AI Summary on YouTube cards. Videos disappear without sending YouTube feedback or marking them watched. Blocks and unblocks sync through your existing Supabase device connection, with offline retries. Manage the list in Preferences; turning the setting off preserves it. Apply the current **Connection → Copy setup SQL** on existing projects to add block-list sync support.

### Watch Detection Methods

- **Browser Navigation**: Mark videos when opened in browser
- **Browser History**: Sync from browser's history data
- **YouTube Progress**: Detect when video progress is reported to YouTube
- **YouTube History**: Sync from YouTube's watch history
- **Video Rating**: Mark videos when liked or disliked

### Data Storage & Backup

- **Local Storage**: IndexedDB for primary data storage with proper indexing
- **Supabase Integration**: Optional cloud database storage via PostgreSQL
- **Manual Export/Import**: JSON-based backup and restore functionality
- **Bidirectional Sync**: Merge data between IndexedDB and Supabase

### User Interface

- **Modern Design**: Responsive, mobile-friendly interface built with Bootstrap
- **Dark/Light Theme**: Automatic theme switching with system preferences
- **Options Page**: Comprehensive settings management
- **Popup Search**: Quick search interface accessible from browser toolbar
- **Viewing Insights**: Rolling activity totals, viewing timelines, average-week and
  calendar heatmaps, streaks and a searchable title word cloud
- **Continuous History**: Scroll through the popup or full library without page controls; videos load in small batches and TanStack Virtual keeps the rendered list bounded
- **Real-time Updates**: Live status indicators and progress reporting
- **Accessibility**: ARIA labels and keyboard navigation support

## Technical Architecture

### Viewing insights

The popup leads with viewing hours over the past 24 hours, 7 days and 30 days,
a seven-day duration preview, and a supporting watch count. **Insights** opens one
statistics dashboard in the options page. There is no units switch: duration
leads the totals, daily average, timeline, average-week heatmap and calendar;
activity counts describe different videos and most-recorded videos.
Periods cover rolling 24-hour, 7-, 30-, 90- and 365-day windows and all time.
A quarter means 90 days; comparisons use the preceding equal-length window.

Activity totals reconcile imported snapshots by video and local calendar day:
multiple browser URLs, YouTube's date-only history and migrated timestamps count
once that day, or are covered by the tracked sessions on that day. Separate
tracked sessions remain separate, including actual replays. Raw events and
exports are retained unchanged. Lifetime counters and undated counts never enter
period totals. Activity is not proof of completed viewing. New live playbacks
require at least 60 seconds of measured viewing before navigation, progress or
rating signals can mark a video. Each replay needs its own minute; shorter videos
and short loops do not qualify. Browser and YouTube history imports backfill
dates before this installation first ran with the import boundary. That boundary
is stored locally at the start of that day and persists across restarts. A visit
cannot prove a minute of viewing, so newer browser history and undated YouTube
cards are excluded, including in manual imports and previews. Newer YouTube
history adds a video only when it is missing entirely and YouTube's own resume
position is at least a minute in, which also covers other devices. YouTube never
shows less than 10%, so that value proves nothing, and such a video stays out
until a client measured it. These additions are day-only and never add a replay
to a known video. Every sync also restores plays whose measured time was saved
without a watch, using the first measured moment; it skips deleted videos and
days already covered by an import. Existing saved history is retained; use the
reconciliation preview below for old overlaps.
Subtracting distinct videos from mixed-source
records cannot establish repeat watches, so Insights does not show that claim.
Browser and YouTube source imports also skip timestamps already recorded for
that video, including playback timestamps. YouTube's day-only imports check the
whole local calendar day. Different dates before the boundary remain importable.
Liked-video imports have no watch timestamp, so they skip already-known video
IDs entirely, including deleted videos. New likes are imported once as undated
records and do not contribute to period activity totals.

The history trash action removes every stored watch of a video locally, syncs
its deletion to Supabase, and removes it from the signed-in YouTube account's
watch history, including older history pages. Local and cloud deletion markers
prevent stale devices or imports from restoring the video. Records and watch
events are retained behind those markers; this is not a permanent data purge.
Cloud and YouTube failures are shown as pending, with durable retries every
30 seconds and after extension restarts. Supabase must be connected and YouTube
must be signed in to complete all three destinations.

**Sync & data → Reconcile old imports → Preview reconciliation** inspects the
database without changing history or the sync outbox. It shows redundant import
records, affected videos, before/after stored watch counts, preserved playback
sessions and undated counts, plus affected-video examples. One **Approve entire
batch** or **Decline entire batch** decision covers all videos. Reloading the
extension, previewing and declining never apply the repair.

Approval is bound to that exact preview's event IDs; newly arriving records do
not expand the approved scope. The repair retains all original events and
appends replicated correction receipts for redundant observations. It commits
in batches with an atomic resume cursor and cloud outbox. Interrupted approved
batches can resume; stale devices cannot undo completed corrections. Supabase
must be connected and have the import-reconciliation migration before approval.
**Copy repair SQL** provides the migration for an existing Supabase project.
After syncing, the extension reads back the receipts and materialized counts
before reporting Supabase verification. Pending sync can be retried. Playback
sessions, distinct days, titles, deletions and undated historical counts remain.
Counter-only duplication cannot be inferred reliably and is not guessed away.

Title words count **different videos in the selected period**, once per word
per video. Rewatches and repeated words in a title do not increase a word's
count. Unicode-aware segmentation preserves accents, short terms such as AI
and VR, and technical names such as C++. English/German filler words, URLs and
video-format labels are excluded. English and German inflections share readable
dictionary-backed base words, using Wink/WordNet and spaCy lookup data with Franc
language detection. Country names and demonyms in both languages share groups. Each
video counts once per resulting word family, even if it contains several forms.
The top 40 words appearing in at least two videos are ordered by frequency.
The horizontal cloud uses square-root font sizing with a readable minimum;
near ties remain similar in size. Tooltips and accessible labels give exact
video counts. Selecting a word searches the full library.
See [the word-cloud design notes](docs/word-cloud.md) for rationale and sources.

Measured playback time is synchronized across all linked devices using stable,
cumulative snapshots. Both MacBooks and SmartTube contribute to the shared
history; a replacement device restores their combined measurements. Existing
browser-only measurements are uploaded automatically on the next successful
sync. See [the duration sync contract](docs/playback-time-sync.md) for measurement,
retry, recovery, privacy and schema-upgrade details. Install sync schema 4 and
update every client before relying on complete cross-device measured totals.

Historical viewing estimates stop when the next timestamped video starts.
Optional video lengths cap those intervals and estimate date-only records.
These remain clearly marked estimates, with synced measurements taking priority. See
[historical duration estimates](docs/historical-duration-estimates.md) for setup,
API-key storage, quota limits, retries, expiry and estimation limits.

All calendar years are stacked newest first, back to the earliest saved date;
colors use fixed duration thresholds (0, under 15 minutes, 15–60 minutes,
1–3 hours, 3+ hours) across years. Every day also reveals its watch count.
The average week divides local weekday/hour playback totals by calendar
occurrences, including inactive days and partial boundary days. Its weekday
watch averages also include dated imports, so saved activity remains visible
without measured playback time. Calendar totals, weekday averages, title words,
and video rankings all use the selected period. Long timelines
aggregate by month. Heatmaps support arrow keys, Home/End, and exact values in
accessible names and pointer/focus details.

Watch counts aggregate individual events across the complete local library,
independently of search. Approximate dates never invent hourly activity;
undated counts and future-dated events are excluded from dated totals.
The word cloud counts each word once per distinct video in the selected period,
removes English/German filler words and generic YouTube terms, retains accented
letters, and requires at least two matching titles. Selecting a word searches
the library. Channel and category metadata are unavailable.

Visualization research was checked on 1 November 2026 against guidance available
by October 2026. [YouTube's 2025 Recap](https://blog.youtube/news-and-events/youtube-recap-2025/)
emphasizes interests and changing viewing habits. [Datawrapper's scale guidance](https://www.datawrapper.de/blog/diverging-vs-sequential-color-scales)
supports sequential colors for nonnegative activity. [W3C chart accessibility](https://www.w3.org/WAI/tutorials/images/complex/)
and [Datawrapper accessibility practices](https://www.datawrapper.de/academy/how-we-make-sure-our-charts-maps-and-tables-are-accessible)
inform summaries, keyboard access, and non-color value descriptions. Playback
measurement follows [MDN media events](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement)
and [Chrome extension persistence](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).
No new service, permissions, or chart library is required.

### Modern Stack

- **Manifest V3**: Latest Chrome extension standard
- **ES6+ Modules**: Modern JavaScript with imports/exports
- **Service Worker**: Background script using latest APIs
- **IndexedDB**: Local database with proper indexing and transactions
- **PostgREST API**: Direct PostgreSQL access via Supabase

Run `npm ci` to install development dependencies and `npm run build` to
regenerate the bundled dependencies, copy the SQL migrations needed by the
settings UI, and validate extension imports and assets. Load `extension/` in
Chrome. Run `npm run package` to create `dist/youtube-watchmarker-1.3.1.zip`;
the archive contains only the installable extension and its licenses.

Use `npm test`, `npm run lint`, and `npm run format:check` for local checks.
Chrome integration tests use the installed Google Chrome application; set
`CHROME_PATH` when it is installed elsewhere.

### Code Structure

- **`extension/`** — Self-contained Chrome extension; `manifest.json` lives here
- **`extension/background/`** — Service worker, scheduling, settings and message routing
- **`extension/handlers/`** — Message handlers grouped by domain
- **`extension/history/`** — History records, imports, reconciliation and playback time
- **`extension/providers/`** — IndexedDB, Supabase, credentials and device linking
- **`extension/sources/`** — Browser/YouTube history, liked videos and source requests
- **`extension/duration/`** and **`extension/statistics/`** — Duration estimates and statistics
- **`extension/youtube/`** — YouTube content scripts
- **`extension/content/`** and **`extension/ui/`** — Options page, styles and shared UI
- **`extension/shared/`** and **`extension/vendor/`** — Shared utilities and bundled dependencies
- **`extension/verification/`** — Public device-verification page, also deployed to GitHub Pages
- **`tests/`** — Node and Chrome integration tests; fixtures and SQL checks in `tests/support/`
- **`scripts/`**, **`data/`** — Build tools and pinned language-data sources
- **`supabase/`** — Canonical migrations, Edge Function and deployment configuration
- **`docs/`** — Design notes and setup documentation

Machine-specific assistant/editor settings, environment files, credentials,
dependencies and generated packages are ignored by Git. Keep `.mcp.json` and
`.codex/` local. Public source code, database migrations and dependency licenses
remain versioned. The manifest's `key` is a public key used to preserve the
extension identity.

### Database Schema

```javascript
{
  strIdent: "abcdefghijk",       // YouTube video ID (11 characters)
  intTimestamp: 1767225600000,  // Last watched timestamp in milliseconds
  strTitle: "Video Title",      // Video title
  intCount: 1,                 // View count
  intDeletedAt: 0,             // Synced deletion timestamp; 0 when never deleted
  intImportedCount: 0,         // Historical/imported count baseline
  intUnknownCount: 0,          // Baseline views without an individual date
  watchEvents: [{              // Included in sync and JSON exports
    eventId: "playback:…",     // Stable playback identity, reused on retry
    watchedAt: 1767225600000,  // Actual occurrence time, in UTC milliseconds
    source: "playback",        // playback, saved source observation, or receipt
    precision: "exact",        // exact, day, or inferred for old source data
    observedDeletion: 0        // Deletion marker observed when this watch began
  }]
}
```

IndexedDB stores video summaries and individual events separately in `storeDatabase`
and `watchEvents`. Supabase uses `youtube_watch_history` and `youtube_watch_events`,
with an owner-scoped composite primary key and timestamp indexes. Event rows are
append-only for authenticated clients. Video titles, latest dates and counts remain
summaries for thumbnail marking; the library and popup show individual occurrences.

Existing databases migrate automatically on extension reload. The latest saved
timestamp becomes one source observation. Older counts are preserved, but timestamps
that were already overwritten cannot be reconstructed. Their date fields stay blank.
Date-only source observations never display an invented exact time. The trash action
removes all watches of that video from the visible history; a new explicit playback
starts visible history again without restoring earlier deleted entries.

The design follows [append-only event and idempotency guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing),
[PostgreSQL key constraints](https://www.postgresql.org/docs/18/ddl-constraints.html),
and [IndexedDB upgrade transactions](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB).
It uses a small event log rather than a full event-sourcing framework.

## Browser Compatibility

- **Chrome/Chromium**: Full support with all features
- **Other Chromium browsers**: Not separately validated
- **Safari**: Not currently supported

## History and device sync

Every device keeps a complete local copy. Supabase is optional: recording,
searching and viewing local history work without a cloud connection. Once connected, Supabase holds the
shared history for both MacBooks and SmartTube. A new or reinstalled device
restores that history automatically after linking to an existing device.
Normal restoration does not require an exported file.

- Watch events, local summaries and pending uploads commit in one IndexedDB
  transaction. Lost replies and worker restarts can retry the same playback
  without incrementing its count again, including offline. Event IDs are retained
  permanently, including after more than 128 later watches. Concurrent offline
  watches from different devices merge by event identity, keeping both timestamps.
- Uploads retry after failures and restarts; old imports are never skipped by a
  watch-date watermark.
- Downloads merge all remote records in stable ID pages. Missing remote rows
  never mean deletion. Daily reconciliation can rebuild missing cloud rows.
- The trash button creates a synced deletion marker. Offline devices and source
  reimports cannot bring that video back. A later explicit watch can restore it.
- Imports merge with existing history. There is no automatic pruning or reset.
- Supabase is the recovery source for a replaced device. Unsynced changes still
  require the original device to reconnect before another device can recover them.

### Connect your devices

1. In Supabase, enable **Authentication → Sign In / Providers → Anonymous
   Sign-Ins**, and obtain a modern `sb_publishable_…` key from **Settings → API Keys**.
   No email provider, SMTP server, username, password, or OAuth app is needed.
2. Run [the base database setup](supabase/migrations/20261101000000_durable_history_sync.sql)
   followed by [the watch-event migration](supabase/migrations/20261101010000_watch_events.sql)
   followed by [device linking](supabase/migrations/20261101020000_device_linking.sql)
   followed by [import reconciliation](supabase/migrations/20261101030000_import_reconciliation.sql)
   followed by [playback-time sync](supabase/migrations/20261101040000_playback_time_sync.sql)
   followed by [anonymous access hardening](supabase/migrations/20261101050000_anonymous_access_hardening.sql)
   followed by [CAPTCHA configuration](supabase/migrations/20261101060000_captcha_configuration.sql)
   followed by [short connection codes](supabase/migrations/20261101070000_short_connection_codes.sql)
   followed by [video duration sync](supabase/migrations/20261103000000_video_duration_sync.sql)
   and [watch-event precision](supabase/migrations/20261103010000_watch_event_precision.sql)
   in the project's SQL Editor. All ten preserve existing history.
   **Sync & data → First device setup → Copy setup SQL** copies all ten in order.
   Follow [the CAPTCHA setup](docs/anonymous-sign-ins.md#captcha-and-signup-abuse)
   to register your public Turnstile site key and configure its secret in Supabase.
   For an existing project, apply the import-reconciliation migration so the
   server's materialized `int_count` also reflects correction receipts. Updated
   extension clients already reconcile downloaded events even before that SQL
   migration; older server triggers retain inflated summary counters until it runs.
3. Under **First device setup**, enter the project ID and publishable
   key, then choose **Create new history**. Do this only for the first device:
   entering the same project settings on another Mac creates an isolated history.
   To restore existing history, use the connection code in the next step.
   If this device is already connected, keep its session and skip this step.
4. Choose **Create connection code** under **Sync & data** on a connected computer.
   Enter the six letters (for example **KMT-PXR**) on the new device and choose
   **Connect**. Lowercase and an omitted hyphen also work; a copy button is available.
   For SmartTube, open **Settings → Extensions → Cloud sync**, enter the code on the
   TV and choose **Connect**. Device verification runs inside the app. A shared temporary pairing directory resolves each
   code to its issuing installation's public project settings. Different
   installations keep their own databases; new devices enter no project ID or key.
   Codes expire after ten minutes, connect
   one device, and are replaced when their issuing device creates another code.
   Existing installations must apply the short-code migration and update both
   clients. See [pairing directory deployment and privacy](docs/device-pairing.md).
5. Reload the updated extension on both MacBooks. Other sync clients, including
   SmartTube, need to write watch events using the version 4 contract for their
   rewatches to appear individually; counter-only writes cannot supply past dates.

The extension uploads pending changes every 30 seconds while Chrome can run,
checks remote history every five minutes, and checks immediately on startup,
connection, or **Sync now**. SmartTube queues network-constrained work after a watch
and has a 15-minute periodic retry. OS scheduling and connectivity can delay work.
Cloud restoration resumes from its last committed page after an interruption.

### Authentication

Only publishable keys are accepted by the shipped clients. A publishable key
identifies the app; each device's short-lived Auth JWT authorizes access to its
rows. Requests put these in separate `apikey` and `Authorization: Bearer` headers.
RLS resolves the device's server-controlled membership to a shared history owner.
Unlinked devices can access only their own rows. Database merges run with caller permissions.
Neither client contains a secret key, service-role key, or JWT signing secret.

The apps create anonymous Auth sessions without asking for personal information.
Every installation keeps its own refresh token; connection codes never contain
access or refresh tokens. Invitation hashes and membership live in a private
schema accessible only through narrowly scoped authenticated functions. Refresh
tokens are encrypted at rest. Temporary network errors retain the session for
retry. Local history is bound to its shared owner, preventing accidental uploads
to another history. The clients accept Auth's opaque access tokens, including tokens issued
using asymmetric signing keys; signing-key rotation is managed in Supabase.

Apply the anonymous-access hardening migration to existing projects as well.
It enforces ownership even alongside a leftover permissive policy, removes
excess browser table grants, and blocks old administrative RPCs. See
[anonymous sign-in security](docs/anonymous-sign-ins.md) for the access model,
local SQL regression test, and CAPTCHA deployment requirements.

This follows Supabase's [API key guidance](https://supabase.com/docs/guides/getting-started/api-keys),
[key migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys),
and [anonymous Auth guidance](https://supabase.com/docs/guides/auth/auth-anonymous),
checked on 1 November 2026 for the October 2026 refactor. Browser scheduling and
storage follow [Chrome's worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
and [persistent extension storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

### Import and export

Import history accepts the current JSON video array, JSON wrapped in
`{"objVideos": [...]}` (including the original extension's `objResponse` envelope),
and the original extension's base64-encoded UTF-8 `.database` backups. The format
is detected automatically; imports merge with your existing history.

JSON exports include every watch event and deletion marker. Importing the same
export repeatedly preserves timestamps without duplicating watches or undoing a
deletion. Export/import is optional for manual transfer; linking to Supabase is
the normal way to restore a device.

Keep a connected device available to link replacements. If all device sessions
are lost, the history still exists in Supabase but requires administrator-assisted
relinking; the public project key cannot recover ownership. Never delete the
anonymous Auth users as temporary guests: they are durable device identities.
Portable SmartTube backups deliberately exclude Watchmarker sessions so restoring
a backup cannot clone a rotating refresh token onto a second TV.

### Verification

`npm test` includes actual Chrome IndexedDB checks when Chrome is installed at its
standard macOS path; set `CHROME_PATH` on other systems. They cover upgrade,
rollback, concurrent writes, restart, offline retries, multi-device merging,
deletions, restoration, timestamp retention, clock rollback, and late playback
retries. No live Supabase account is contacted.

Chrome checks also exercise infinite scrolling in the popup and full library,
bounded rendering, search/filter resets, layout changes, retries, and deletion
while retaining loaded history. These checks use isolated fixture records.

`tests/support/history-schema.sql` verifies merge rules, owner isolation, explicit
deletions, stale-client writes, append-only events, idempotent retries and repeat
setup in a **disposable local Postgres
database only**. It creates test Auth roles and must not run against a real project.

`tests/support/device-link.sql` separately checks three linked device identities,
shared summary/event reads and writes, unrelated-user isolation, private-table
access, expired and consumed codes, and repeat setup in a disposable database.

## Privacy & Security

- **No Analytics**: The extension has no analytics or telemetry. Optional sync
  sends history to your Supabase project; visible thumbnails request images from
  YouTube's image CDN.
- **Local-First**: Primary storage is local IndexedDB
- **User Control**: Complete control over sync settings and data sharing
- **Optional Cloud**: Supabase integration is entirely optional
- **Open Source**: Full source code available for inspection

## FAQ

**How can I restore a replacement device?**
Install the extension or SmartTube, connect to the same project and sign in to
the same sync account. The complete cloud history downloads automatically.

**How do I set up Supabase sync?**  
Follow **Connect your devices** above. There is one local store and one automatic
sync process; no primary-database selector, migration direction or auto-sync
switch is needed.

**What's the difference between browser history and YouTube history sync?**  
Browser history sync extracts YouTube video visits from your browser's history, while YouTube history sync fetches your watch history directly from YouTube's API. Both sources are merged for completeness.

**Can I customize how watched videos are displayed?**  
Yes, the extension offers multiple visual options including fade-out, grayscale, badges, watch dates, and hiding progress bars. All can be enabled/disabled independently.

## Special Thanks

I would like to express my gratitude to [Simon Niklaus](https://github.com/sniklaus) who developed the original extension of which this is a fork.

## Links

- **Original Project**: https://github.com/sniklaus/youtube-watchmarker
- **Current Fork**: https://github.com/widike/youtube-watchmarker

## License

Please refer to the [LICENSE](LICENSE) file within this repository.

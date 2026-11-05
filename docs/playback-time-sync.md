# Shared playback time (sync contract 4)

Measured playback time belongs to the shared history owner. Every linked
installation uploads its measurements and downloads the union; Insights and
the popup sum that union, regardless of which device displays it.

Apply `20261101040000_playback_time_sync.sql` after the four preceding November
2026 setup migrations. **Copy setup SQL** includes the complete sequence.
The extension and SmartTube require sync version 4. Update both MacBooks and
SmartTube; an older client cannot report duration just by changing its label.
The additive migration retains existing history and device memberships.

## Measurement and identity

Both clients measure elapsed wall time against advancing media position,
accounting for playback speed and excluding pauses, stalls, seeks and sleep.
The existing one-minute qualification rule remains: after a play qualifies,
its buffered first minute and subsequent measured time are retained. TV time
continues past the qualification threshold. Separate simultaneous players count
separately. Abrupt termination can lose an unflushed tail.

Each playback gets a globally unique ID. A snapshot has a stable identity per
playback and UTC minute; it carries a cumulative millisecond total, observed
span, video ID, watch-event ID and optional media coverage. SmartTube event
timestamps also travel with each snapshot so replaying a restored snapshot
cannot create a conflicting watch date. Downloading a snapshot preserves its
identity and does not create another measurement.

`youtube_watch_time` has the key `(user_id, snapshot_id)`. A trigger rejects
identity changes, retains the larger cumulative total and prevents time moving
backwards. Owner-scoped RLS uses the existing linked-device membership function.
Anonymous clients and unrelated owners have no access; clients cannot delete
the retained measurements through the API. History deletion markers still
exclude the corresponding old measurements from visible statistics.

## Durability and recovery

The extension commits a measurement and its outbox obligation together in
IndexedDB. SmartTube does the same in SQLite. Upload acknowledgement checks the
revision, so an older network reply cannot acknowledge newer time. Failed and
lost replies remain retryable. Download cursors advance only after local commit.
The extension downloads only server-revision changes and does not periodically
republish retained snapshots. Its initial local migration runs once, then durable
outboxes carry new changes. Apply `20261105010000_incremental_sync.sql` for this
download protocol; the version 4 upload contract remains the same for SmartTube.
A newly linked device restores the shared duration union.
Existing browser-only measurements are queued automatically under their original
IDs on the first sync, preserving their measured totals without duplication.

Credentials, device sessions, and YouTube API keys never travel in duration
rows. Duration synchronization uses the existing authenticated Supabase
connection and its existing recipients. Video-array JSON exports remain video
exports; cloud restoration, rather than those exports, recovers duration data.

Historical video-length estimates remain explicitly marked as estimates; they
are not recovered measurements. Their optional API cache also syncs across Macs
after applying `20261103000000_video_duration_sync.sql`; see
[historical duration estimates](historical-duration-estimates.md).
Past actual playback that no client measured cannot be reconstructed.

## Validation

The browser integration suite checks two-device convergence, replacement-device
restoration, old local-data migration, lost replies, database reopen, in-flight
revision protection, identity collisions and recovery after cloud loss.
`tests/support/playback-time-schema.sql` tests real PostgreSQL monotonic merges,
linked-device access, unrelated-owner/anonymous isolation, immutable IDs,
retained measurements and repeat migration setup in a disposable database.
SmartTube tests exercise full-length wall time at 2× speed, pauses, seeks,
qualification, replay identities, SQLite reopen and durable retry state.

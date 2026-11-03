# Historical viewing-time estimates

Historical watch time is estimated from timestamped video starts. Optional
video lengths from the official YouTube Data API limit estimates to the video's
runtime and provide estimates for date-only history and the final timed watch.
In **Sync & data → Backfill video durations**, enter an API key with YouTube
Data API v3 enabled and select **Save & start**. To replace a saved key, paste
the new key and select **Save & resume**. The key is encrypted in local storage;
it is sent only to the official API and is never synced or returned in status
responses. **Pause** stops background requests; **Remove key & local cache** also
removes cached lengths on this Mac, preserving timestamp-based estimates and
measured playback.

Video lengths and unavailable-video markers sync through Supabase alongside
history and measured playback. Apply
`supabase/migrations/20261103000000_video_duration_sync.sql` to existing projects;
**Copy setup SQL** includes it for new or existing projects. Reload the updated
extension on both Macs, then select **Sync now** on the Mac holding the cached
lengths and on the new Mac. Existing valid local cache entries are uploaded
automatically. A receiving Mac needs no YouTube API key to display synced lengths
and calculate historical viewing estimates. Its duration panel shows the available
count even without a key. API keys, backfill controls and quota budgets stay local.

Cache writes and upload obligations commit together. Interrupted transfers retry
after restart, downloads resume from committed pages, and newer fetches replace
older observations on every device. Daily reconciliation repairs missing cloud
entries. Sync preserves the original fetch and expiry dates; expired lengths are
removed locally and from the shared table. **Remove key & local cache** clears
this installation's key, lengths and pending cache uploads; valid shared lengths
can return on the next cloud download. It does not delete shared playback time.

Backfill processes the newest dated videos first, deduplicating IDs into batches
of 50. It sends at most one batch every 30 seconds and reserves a local budget
of 1,000 requests per Pacific day, including failed requests. Chrome alarms and
persistent progress resume work after page closure or worker/browser restarts.
Transient failures use exponential backoff with jitter and respect Retry-After;
quota exhaustion waits for Pacific midnight. Invalid credentials and six
consecutive failures require **Resume**. Completed jobs check for new history
hourly. Loading history with missing video lengths wakes an idle job after
30 seconds, without bypassing pause, retry or quota limits. The history grid
updates fetched duration badges automatically while preserving loaded pages
and scroll position. Durations expire after 29 days and are refreshed. Videos
omitted from a successful API response, or individually reported as not found, are marked
unavailable locally and skipped on subsequent runs, including after restarts.
This includes deleted and private videos; YouTube does not identify the reason.
Their history and measured playback remain intact, with no invented duration.
**Remove key & local cache** clears local skip markers too, allowing a fresh attempt
if a private video becomes public again, unless sync restores the shared marker first. A batch-level not-found error is split
into smaller requests to isolate missing videos without skipping accessible
ones; the usual pacing and quota limits still apply. Returned videos without
a usable duration, including unfinished live videos even when they report a
nonzero runtime, are retried after one day.
Expired duration metadata is purged when accessed and by hourly maintenance.

For each historical watch with a time of day and no matching measured playback,
viewing is estimated from its timestamp until the next timestamped video starts.
The interval stops earlier if the video ends or reaches the current time, and
is limited to 24 hours per occurrence. For example, a 10-hour fireplace video
followed by another video 15 minutes later contributes 15 minutes. The next
video ends the estimate even if its own duration is unavailable or it has measured
playback. Intervals are split across local hours and days for charts and rolling
windows. Existing cached lengths use this calculation immediately.
If the length is unavailable, a known next start still supplies an estimate;
the final watch needs a known length. Watches sharing a timestamp share the
inferred interval because their order is unknown.

Date-only imports cannot establish a viewing sequence and use the video length
as their starting estimate, up to 24 hours. Non-finite lengths are excluded.
For each local day, estimates are reduced proportionally when their sum exceeds elapsed time
remaining after measured playback. Today's budget ends at the current time;
daylight saving changes use the actual 23/25-hour day. Rolling windows further
limit estimates to the part of each day inside that window. Measured playback
is preserved, including simultaneous playback across devices. These are upper
bounds on estimates, not recovered viewing measurements.
The same import-overlap rules as the activity totals apply.
Undated counts get no invented dates or hours;
day-only imports contribute daily time without inventing an hour. Matching synced
playback measurements take priority. Estimates update Insights automatically and
are labeled as Watchmarker calculations, not YouTube watch-time data. The synced
video-length cache and its estimates remain separate from measured playback
and are excluded from history exports.
Without a length or a known next start, a watch contributes no estimated hours;
partial annual totals identify these gaps while backfill is still in progress.

# Historical video-length estimates

Historical watch time can be estimated with the official YouTube Data API.
In **Sync & data → Backfill video durations**, enter an API key with YouTube
Data API v3 enabled and select **Start**. The key is encrypted in local storage;
it is sent only to the official API and is never synced or returned in status
responses. **Pause** stops background requests; **Remove key & cache** also
removes cached durations and their estimates, preserving measured playback.

Backfill processes the newest dated videos first, deduplicating IDs into batches
of 50. It sends at most one batch every 30 seconds and reserves a local budget
of 1,000 requests per Pacific day, including failed requests. Chrome alarms and
persistent progress resume work after page closure or worker/browser restarts.
Transient failures use exponential backoff with jitter and respect Retry-After;
quota exhaustion waits for Pacific midnight. Invalid credentials and six
consecutive failures require **Resume**. Completed jobs check for new history
hourly. Durations expire after 29 days and are refreshed. Videos omitted from a
successful API response, or individually reported as not found, are marked
unavailable locally and skipped on subsequent runs, including after restarts.
This includes deleted and private videos; YouTube does not identify the reason.
Their history and measured playback remain intact, with no invented duration.
**Remove key & cache** clears these skip markers too, allowing a fresh attempt
if a private video becomes public again. A batch-level not-found error is split
into smaller requests to isolate missing videos without skipping accessible
ones; the usual pacing and quota limits still apply. Returned videos without
a usable duration (such as unfinished live videos) are retried after one day.
Expired duration metadata is purged when accessed and by hourly maintenance.

Each dated historical activity record without matching measured playback uses
the full video length as estimated watch time. The same import-overlap rules as
the activity totals apply. Undated counts get no invented dates or hours;
day-only imports contribute daily time without inventing an hour. Matching synced
playback measurements take priority. Estimates update Insights automatically and
are labeled as Watchmarker calculations, not YouTube watch-time data. The optional video-length cache and its estimates remain separate from synced
measurements and are excluded from history exports.
Unavailable durations contribute no estimated hours; partial annual totals are
identified while backfill is still in progress.

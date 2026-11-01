# Chrome extension review — October 2026

Research checked on 1 November 2026 against Chrome's official documentation and
Context7. These are platform requirements and design choices relevant to this
extension, rather than a claim that each recommendation was introduced in October.
The official [extension changelog](https://developer.chrome.com/docs/extensions/whats-new)
returned during research had an August 2026 entry at the top; no October-specific
release announcement was established.

## Design decisions

- **Treat the worker as disposable.** Register event listeners synchronously;
  await initialization inside handlers. Store pending writes, acknowledgements,
  and resumable sync positions durably. Neither a timer nor a singleton is a
  persistence mechanism. [Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
  [service worker migration](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers).
- **Keep history local first.** Watching a video must complete without waiting for
  network availability. Use IndexedDB for history and durable sync work,
  `storage.sync` for small preferences, and `storage.session` for transient
  state that must survive worker suspension. Restrict sensitive storage to
  `TRUSTED_CONTEXTS`. [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).
- **Use one message transport.** This project uses `runtime.sendMessage`; unused
  long-lived connection routing adds an unnecessary second implementation. Keep
  the asynchronous response channel open with a literal `true` when using
  `sendResponse`. [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
- **Validate at the trust boundary.** Content scripts may request video lookup
  and report watches, but settings, credential, import, and administrative
  actions belong to extension pages. Check the extension ID and exact sender
  origin; reject malformed messages, invalid IDs, oversized titles, and supplied
  watch-date/count overrides. Do not log whole requests containing credentials.
  [Extension security](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure).
- **Schedule durable work with alarms.** Recreate missing alarms when the worker
  starts, while preserving existing schedules. Do not reset the next run on
  every worker initialization. [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms).
- **Request only permissions used by current features.** Remove permissions when
  their API callers disappear. Optional cloud functionality is a candidate for
  requesting its host permission during connection setup.
  [Declaring permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions).
- **Observe actual DOM changes.** YouTube is a single-page application and reuses
  cards. A URL/title/card-count snapshot does not establish that cards are
  unchanged. Observe relevant attributes and child changes, coalesce refreshes,
  and retain a pending refresh when asynchronous lookups are running. Avoid one
  observer per thumbnail.
  [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe).

## Message boundary implemented in this review

`message-router.js` now checks sender identity, restricts content origins and
privileged actions, validates video metadata, and uses one response/error path.
Unused port routing and unused handler-management methods were removed. Regression
tests cover authorized messages, blocked settings/credentials, spoofed origins,
malformed requests, metadata overrides, and asynchronous listener responses.

Handler wrappers now use one options-object signature; unused error-log machinery,
validators, constants and tab-message retries were removed. Visual preferences
share their key list and apply each configured stylesheet once. The unsupported
native-badge detection control was removed.

`history-playback.js` now commits a playback receipt, updated view count and upload
obligation in one IndexedDB transaction. This replaces separate session-storage
bookkeeping. Real Chrome checks cover a lost reply followed by reopening the
database, transaction rollback, duplicate events, and deletion followed by an old
or genuinely new playback. A separate startup test verifies that database
initialization creates the cloud alarm and preserves its next scheduled run.
Virtualized views use immediate programmatic scrolling so Bootstrap's smooth
scrolling cannot race their scroll-position corrections during display changes.

## Acceptance before release

Local tests cannot establish that YouTube's current DOM and private history API
still behave as expected. Verify unpacked Chrome operation for navigation,
playback, Shorts, multiple tabs, recycled recommendations, option changes, and
history import. Explicitly stop the service worker and verify that recording and
sync resume; repeat with offline changes and a restarted browser. Exercise cloud
sync against a separate test account before using production history.
[Chrome end-to-end testing guidance](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing).

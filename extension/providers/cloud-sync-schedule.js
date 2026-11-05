const POLL_INTERVAL = 5 * 60_000;
const MAX_BACKOFF = 60 * 60_000;

// Persisted independently of the MV3 worker lifetime. Local outboxes can bypass
// the idle poll interval, but must respect backoff after a failed request.
export function shouldSync(status, { now, pending, force = false }) {
  if (force || !status.lastAttempt || now < status.lastAttempt) return true;
  if (status.retryAt > now) return false;
  return Boolean(
    status.failures > 0 ||
      pending ||
      status.inProgress ||
      now - status.lastAttempt >= POLL_INTERVAL,
  );
}

export function scheduleSync(status, result, now) {
  const failures = result.success ? 0 : (status.failures || 0) + 1;
  return {
    failures,
    lastAttempt: now,
    retryAt: failures
      ? now + Math.min(MAX_BACKOFF, 60_000 * 2 ** Math.min(failures - 1, 6))
      : 0,
  };
}

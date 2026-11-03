const ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";

export const DURATION_TTL = 29 * 24 * 60 * 60 * 1000;
export const PENDING_DURATION_TTL = 24 * 60 * 60 * 1000;

function unavailableVideo(strIdent, now) {
  return { strIdent, seconds: null, unavailable: true, fetchedAt: now };
}

export function parseDuration(value) {
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value || "",
    );
  if (!match || !match.slice(1).some((part) => part !== undefined)) return null;
  const seconds =
    Number(match[1] || 0) * 86400 +
    Number(match[2] || 0) * 3600 +
    Number(match[3] || 0) * 60 +
    Number(match[4] || 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export class DurationRequestError extends Error {
  constructor(kind, message, retryAfter = 0) {
    super(message);
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export function retryAfterTime(value, now) {
  if (!value) return 0;
  const seconds = Number(value);
  const time = Number.isFinite(seconds)
    ? now + Math.max(0, seconds) * 1000
    : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export async function fetchDurations(
  ids,
  apiKey,
  { fetcher = fetch, now = Date.now() } = {},
) {
  if (
    !ids.length ||
    ids.length > 50 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[\w-]{11}$/.test(id))
  )
    throw new Error("A batch must contain 1–50 unique video IDs");
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({
    part: "contentDetails,liveStreamingDetails",
    id: ids.join(","),
    fields:
      "items(id,contentDetails(duration),liveStreamingDetails(actualStartTime,actualEndTime))",
    key: apiKey,
  }).toString();
  let response;
  let body;
  try {
    response = await fetcher(url.href, {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Never propagate fetch errors or API messages containing a credential URL.
    throw new DurationRequestError(
      "transient",
      "YouTube could not be reached.",
    );
  }
  try {
    body = await response.json();
  } catch {
    if (response.ok)
      throw new DurationRequestError(
        "transient",
        "YouTube returned an incomplete response.",
      );
    body = {};
  }
  if (!response.ok) {
    const reasons = new Set(
      (body?.error?.errors || []).map(({ reason }) => reason),
    );
    const retryAfter = retryAfterTime(response.headers.get("Retry-After"), now);
    if (reasons.has("quotaExceeded") || reasons.has("dailyLimitExceeded"))
      throw new DurationRequestError(
        "quota",
        "YouTube daily quota reached.",
        retryAfter,
      );
    if (
      response.status === 429 ||
      reasons.has("rateLimitExceeded") ||
      reasons.has("userRateLimitExceeded")
    )
      throw new DurationRequestError(
        "rate",
        "YouTube requested a slower rate.",
        retryAfter,
      );
    if (response.status >= 500 || response.status === 408)
      throw new DurationRequestError(
        "transient",
        "YouTube is temporarily unavailable.",
        retryAfter,
      );
    if (response.status === 404 && reasons.has("videoNotFound")) {
      if (ids.length === 1) return ids.map((id) => unavailableVideo(id, now));
      // A batch error does not identify which video is missing.
      throw new DurationRequestError("not-found", "A video is unavailable.");
    }
    throw new DurationRequestError(
      "configuration",
      "Check the API key, its restrictions, and that YouTube Data API v3 is enabled.",
    );
  }
  if (
    !Array.isArray(body?.items) ||
    body.items.some((video) => !video || !ids.includes(video.id)) ||
    new Set(body.items.map((video) => video.id)).size !== body.items.length
  )
    throw new DurationRequestError(
      "transient",
      "YouTube returned an incomplete response.",
    );
  const durations = new Map(
    body.items.map((video) => [
      video.id,
      video.liveStreamingDetails && !video.liveStreamingDetails.actualEndTime
        ? null
        : parseDuration(video.contentDetails?.duration),
    ]),
  );
  return ids.map((strIdent) => {
    if (!durations.has(strIdent)) return unavailableVideo(strIdent, now);
    const seconds = durations.get(strIdent) || null;
    return {
      strIdent,
      seconds,
      fetchedAt: now,
      expiresAt: now + (seconds ? DURATION_TTL : PENDING_DURATION_TTL),
    };
  });
}

export function pacificDay(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function nextQuotaReset(now) {
  const day = pacificDay(now);
  // Pacific midnight remains on a UTC hour boundary, including DST changes.
  let next = Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000;
  while (pacificDay(next) === day) next += 3_600_000;
  return next + 60_000;
}

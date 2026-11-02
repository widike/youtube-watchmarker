import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchDurations,
  parseDuration,
  DURATION_TTL,
  PENDING_DURATION_TTL,
  nextQuotaReset,
  pacificDay,
} from "../extension/duration/duration-api.js";

const now = Date.parse("2026-11-01T10:00:00Z");
const id = "abcdefghijk";
const response = (status, body, retryAfter) =>
  new Response(JSON.stringify(body), {
    status,
    headers: retryAfter ? { "Retry-After": retryAfter } : {},
  });

test("duration parsing supports hours, days and fractional seconds without accepting missing or live zero durations", () => {
  assert.equal(parseDuration("PT15M33S"), 933);
  assert.equal(parseDuration("P2DT3H4M5.5S"), 183845.5);
  for (const value of [
    undefined,
    "",
    "P",
    "PT",
    "PT0S",
    "15:33",
    "PT-1S",
    "P1Y",
  ])
    assert.equal(parseDuration(value), null);
});

test("API requests persist missing-video skip markers and retry returned live durations later", async () => {
  const ids = [id, "missing____", "live_______"];
  const rows = await fetchDurations(ids, "private-key", {
    now,
    fetcher: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://www.googleapis.com");
      assert.equal(parsed.searchParams.get("id"), ids.join(","));
      assert.equal(
        parsed.searchParams.get("part"),
        "contentDetails,liveStreamingDetails",
      );
      assert.equal(
        parsed.searchParams.get("fields"),
        "items(id,contentDetails(duration),liveStreamingDetails(actualStartTime,actualEndTime))",
      );
      assert.equal(options.credentials, "omit");
      return response(200, {
        items: [
          { id, contentDetails: { duration: "PT1H" } },
          { id: ids[2], contentDetails: { duration: "PT0S" } },
        ],
      });
    },
  });
  assert.deepEqual(
    rows.map((row) => row.seconds),
    [3600, null, null],
  );
  assert.equal(rows[0].expiresAt, now + DURATION_TTL);
  assert.deepEqual(rows[1], {
    strIdent: ids[1],
    seconds: null,
    unavailable: true,
  });
  assert.equal(rows[2].expiresAt, now + PENDING_DURATION_TTL);
  assert.equal(rows[2].unavailable, undefined);
});

test("empty successful responses skip all requested IDs without claiming they were deleted", async () => {
  const rows = await fetchDurations([id, "missing____"], "key", {
    fetcher: async () => response(200, { items: [] }),
  });
  assert(rows.every((row) => row.unavailable && row.seconds === null));
});

test("unfinished streams never supply estimated viewing time, even with a nonzero runtime", async () => {
  for (const liveStreamingDetails of [
    {},
    { actualStartTime: "2026-10-01T00:00:00Z" },
    { actualEndTime: "2026-10-02T00:00:00Z" },
  ]) {
    const [row] = await fetchDurations([id], "key", {
      now,
      fetcher: async () =>
        response(200, {
          items: [
            {
              id,
              contentDetails: { duration: "PT2H" },
              liveStreamingDetails,
            },
          ],
        }),
    });
    const ended = Boolean(liveStreamingDetails.actualEndTime);
    assert.equal(row.seconds, ended ? 7200 : null);
    assert.equal(
      row.expiresAt,
      now + (ended ? DURATION_TTL : PENDING_DURATION_TTL),
    );
    assert.equal(row.unavailable, undefined);
  }
});

test("videoNotFound skips a single video and requires isolation for a failed batch", async () => {
  const fetcher = async () =>
    response(404, { error: { errors: [{ reason: "videoNotFound" }] } });
  assert.deepEqual(await fetchDurations([id], "key", { fetcher }), [
    { strIdent: id, seconds: null, unavailable: true },
  ]);
  await assert.rejects(
    fetchDurations([id, "missing____"], "key", { fetcher }),
    { kind: "not-found" },
  );
  await assert.rejects(
    fetchDurations([id], "key", {
      fetcher: async () => response(404, {}),
    }),
    { kind: "configuration" },
  );
});

test("malformed successful responses cannot permanently mark videos unavailable", async () => {
  for (const items of [[null], [{}], [{ id: "unknown____" }], [{ id }, { id }]])
    await assert.rejects(
      fetchDurations([id], "key", {
        fetcher: async () => response(200, { items }),
      }),
      { kind: "transient" },
    );
});

test("batch validation prevents excessive or duplicate API requests", async () => {
  let called = false;
  for (const ids of [
    [],
    [id, id],
    ["bad"],
    Array.from({ length: 51 }, (_, n) => String(n).padStart(11, "a")),
  ])
    await assert.rejects(
      fetchDurations(ids, "key", {
        fetcher: async () => {
          called = true;
        },
      }),
    );
  assert.equal(called, false);
});

test("API errors distinguish quota, throttling, configuration and transient failures without leaking key URLs", async () => {
  for (const [status, reason, kind] of [
    [403, "quotaExceeded", "quota"],
    [403, "dailyLimitExceeded", "quota"],
    [403, "userRateLimitExceeded", "rate"],
    [429, "", "rate"],
    [503, "", "transient"],
    [400, "keyInvalid", "configuration"],
  ]) {
    await assert.rejects(
      fetchDurations([id], "secret-key", {
        now,
        fetcher: async () =>
          response(
            status,
            { error: { errors: [{ reason }], message: "secret-key" } },
            "120",
          ),
      }),
      (error) => {
        assert.equal(error.kind, kind);
        assert(!error.message.includes("secret-key"));
        if (kind !== "configuration")
          assert.equal(error.retryAfter, now + 120_000);
        return true;
      },
    );
  }
  await assert.rejects(
    fetchDurations([id], "secret-key", {
      fetcher: async () => {
        throw new Error("https://example?key=secret-key");
      },
    }),
    (error) =>
      error.kind === "transient" && !error.message.includes("secret-key"),
  );
  await assert.rejects(
    fetchDurations([id], "key", {
      fetcher: async () => new Response("rate limited", { status: 429 }),
    }),
    { kind: "rate" },
  );
  await assert.rejects(
    fetchDurations([id], "key", { fetcher: async () => response(200, {}) }),
    { kind: "transient" },
  );
});

test("quota resets follow Pacific midnight across spring and fall daylight saving changes", () => {
  for (const [input, expected] of [
    ["2026-03-08T07:55:00Z", "2026-03-08T08:01:00Z"],
    ["2026-03-08T10:00:00Z", "2026-03-09T07:01:00Z"],
    ["2026-11-01T10:00:00Z", "2026-11-02T08:01:00Z"],
  ]) {
    const start = Date.parse(input);
    const next = nextQuotaReset(start);
    assert.equal(next, Date.parse(expected));
    assert.notEqual(pacificDay(start), pacificDay(next));
  }
});

import { durationCandidates } from "./duration-estimates.js";
import { fetchDurations, nextQuotaReset, pacificDay } from "./duration-api.js";

export const DURATION_ALARM = "youtube-duration-backfill";
const BATCH_INTERVAL = 30_000;
const DAILY_BUDGET = 1000;
const IDLE_INTERVAL = 60 * 60 * 1000;

export class DurationBackfill {
  constructor({
    storage,
    getVideos,
    schedule,
    clear,
    fetchBatch = fetchDurations,
    clock = Date.now,
    random = Math.random,
  }) {
    Object.assign(this, {
      storage,
      getVideos,
      schedule,
      clear,
      fetchBatch,
      clock,
      random,
    });
    this.queue = Promise.resolve();
  }

  exclusive(task) {
    const pending = this.queue.catch(() => {}).then(task);
    this.queue = pending;
    return pending;
  }

  async initialize() {
    // Recreate lost alarms without moving an existing retry deadline forward.
    const config = await this.storage.getConfig();
    if (!config.enabled) return;
    const state = await this.storage.getState();
    if (state.status !== "error") {
      const nextAttemptAt =
        state.nextAttemptAt || this.clock() + BATCH_INTERVAL;
      await this.storage.saveState({ ...state, nextAttemptAt });
      await this.schedule(nextAttemptAt);
    }
  }

  control({ command, apiKey }) {
    return this.exclusive(async () => {
      if (!["start", "pause", "forget"].includes(command))
        throw new Error("Invalid duration backfill command");
      const config = await this.storage.getConfig();
      const state = await this.storage.getState();
      if (command === "forget") {
        await this.storage.saveConfig({ enabled: false });
        await this.clear();
        await this.storage.clearCache();
        await this.storage.saveState({
          ...state,
          status: "paused",
          error: "",
          cacheRevision: crypto.randomUUID(),
        });
      } else if (command === "pause") {
        await this.storage.saveConfig({ ...config, enabled: false });
        await this.storage.saveState({ ...state, status: "paused" });
        await this.clear();
      } else {
        if (
          apiKey !== undefined &&
          (typeof apiKey !== "string" ||
            !/^[A-Za-z0-9_-]{20,200}$/.test(apiKey.trim()))
        )
          throw new Error("Enter a valid YouTube Data API key");
        if (apiKey)
          config.apiKey = await this.storage.encryptKey(apiKey.trim());
        if (!config.apiKey)
          throw new Error("A YouTube Data API key is required");
        await this.storage.saveConfig({ ...config, enabled: true });
        // Start/Resume cannot bypass quota or server retry deadlines.
        const nextAttemptAt = Math.max(
          this.clock() + BATCH_INTERVAL,
          state.cooldownUntil || 0,
        );
        await this.storage.saveState({
          ...state,
          status:
            state.cooldownUntil > this.clock()
              ? state.cooldownStatus
              : "queued",
          failures: 0,
          nextAttemptAt,
          error: "",
        });
        await this.schedule(nextAttemptAt);
      }
      return this.status();
    });
  }

  async status() {
    const now = this.clock();
    const [config, state, videos, cache] = await Promise.all([
      this.storage.getConfig(),
      this.storage.getState(),
      this.getVideos(),
      this.storage.readCache(now),
    ]);
    const ids = durationCandidates(videos, now);
    const records = new Map(cache.map((row) => [row.strIdent, row]));
    const available = ids.filter((id) => records.get(id)?.seconds > 0).length;
    const unavailable = ids.filter(
      (id) => records.has(id) && !records.get(id).seconds,
    ).length;
    return {
      configured: Boolean(config.apiKey),
      enabled: Boolean(config.enabled),
      status: config.enabled ? state.status || "queued" : "paused",
      total: ids.length,
      available,
      unavailable,
      remaining: ids.length - available - unavailable,
      nextAttemptAt: state.nextAttemptAt || 0,
      requestsToday:
        state.day === pacificDay(now) ? state.requestsToday || 0 : 0,
      error: state.error || "",
    };
  }

  tick() {
    return this.exclusive(() => this.runBatch());
  }

  async runBatch() {
    const now = this.clock();
    const config = await this.storage.getConfig();
    // Expire metadata even while paused or blocked by a configuration error.
    const cache = await this.storage.readCache(now);
    if (!config.enabled || !config.apiKey) return;
    let state = await this.storage.getState();
    if (state.status === "error") return;
    if (state.nextAttemptAt > now) {
      await this.schedule(state.nextAttemptAt);
      return;
    }
    if (state.day !== pacificDay(now))
      state = { ...state, day: pacificDay(now), requestsToday: 0 };
    if ((state.requestsToday || 0) >= DAILY_BUDGET) {
      await this.defer(
        state,
        "quota",
        nextQuotaReset(now),
        "Daily backfill budget reached.",
      );
      return;
    }
    const ids = durationCandidates(await this.getVideos(), now);
    const cached = new Set(cache.map((row) => row.strIdent));
    const missing = new Set(ids.filter((id) => !cached.has(id)));
    const pendingBatches = (state.pendingBatches || [])
      .map((batch) => batch.filter((id) => missing.has(id)))
      .filter((batch) => batch.length);
    const batch = pendingBatches[0] || [...missing].slice(0, 50);
    if (!batch.length) {
      await this.defer(
        { ...state, failures: 0, pendingBatches: [] },
        "complete",
        now + IDLE_INTERVAL,
        "",
      );
      return;
    }
    let key;
    try {
      key = await this.storage.getKey(config);
    } catch {
      await this.defer(
        state,
        "error",
        0,
        "API key could not be read. Enter it again.",
      );
      return;
    }
    state = {
      ...state,
      status: "fetching",
      requestsToday: (state.requestsToday || 0) + 1,
      nextAttemptAt: now + BATCH_INTERVAL,
      error: "",
    };
    // Reserve quota and a recovery alarm BEFORE HTTP. Worker termination cannot
    // erase a failed attempt's budget or cause an immediate burst on restart.
    await this.storage.saveState(state);
    await this.schedule(state.nextAttemptAt);
    try {
      const rows = await this.fetchBatch(batch, key, { now });
      await this.storage.writeCache(rows);
      await this.defer(
        {
          ...state,
          failures: 0,
          pendingBatches: pendingBatches.slice(1),
          cacheRevision: crypto.randomUUID(),
        },
        "running",
        Math.max(now + BATCH_INTERVAL, this.clock() + BATCH_INTERVAL),
        "",
      );
    } catch (error) {
      const failures = (state.failures || 0) + 1;
      if (error.kind === "not-found" && batch.length > 1) {
        const middle = Math.ceil(batch.length / 2);
        await this.defer(
          {
            ...state,
            failures: 0,
            pendingBatches: [
              batch.slice(0, middle),
              batch.slice(middle),
              ...pendingBatches.slice(1),
            ],
          },
          "running",
          this.clock() + BATCH_INTERVAL,
          "",
        );
      } else if (error.kind === "quota") {
        await this.defer(
          { ...state, failures: 0 },
          "quota",
          Math.max(nextQuotaReset(now), error.retryAfter || 0),
          "YouTube daily quota reached.",
        );
      } else if (error.kind === "configuration" || failures >= 6) {
        await this.defer(
          {
            ...state,
            failures,
            cooldownUntil: Math.max(
              state.cooldownUntil || 0,
              error.retryAfter || 0,
            ),
            cooldownStatus: "retry",
          },
          "error",
          0,
          error.kind === "configuration"
            ? "Check the API key, its restrictions, and that YouTube Data API v3 is enabled."
            : "Backfill paused after repeated failures. Resume to retry.",
        );
      } else {
        const delay =
          Math.min(60 * 60 * 1000, BATCH_INTERVAL * 2 ** (failures - 1)) *
          (1 + this.random());
        await this.defer(
          { ...state, failures },
          "retry",
          Math.max(this.clock() + delay, error.retryAfter || 0),
          "YouTube request deferred; retrying automatically.",
        );
      }
    }
  }

  async defer(state, status, nextAttemptAt, error) {
    const cooling = ["quota", "retry"].includes(status);
    await this.storage.saveState({
      ...state,
      status,
      nextAttemptAt,
      error,
      cooldownUntil: cooling
        ? nextAttemptAt
        : status === "error"
          ? state.cooldownUntil || 0
          : 0,
      cooldownStatus: cooling
        ? status
        : status === "error"
          ? state.cooldownStatus || ""
          : "",
    });
    if (nextAttemptAt) await this.schedule(nextAttemptAt);
    else await this.clear();
  }
}

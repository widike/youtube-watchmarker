"use strict";

(() => {
  const watchmarker = globalThis.YouTubeWatchmarkerContent;
  const MINUTE = 60_000;
  watchmarker.MINIMUM_WATCH_MILLISECONDS = MINUTE;

  class WatchTimeTracker {
    constructor(client, clock = () => Date.now()) {
      this.client = client;
      this.clock = clock;
      this.pending = new Map();
      this.snapshots = new Map();
      this.lastFlush = 0;
    }

    observe(player, type, session) {
      const now = this.clock();
      const wasQualified = session.watchedMilliseconds >= MINUTE;
      const previous = this.previous;
      const rate = Number(player.playbackRate) || 1;
      if (
        previous?.player === player &&
        previous.session.sessionId === session.sessionId &&
        previous.playing
      ) {
        const elapsed = now - previous.at;
        const media =
          ((player.currentTime - previous.media) * 1000) / previous.rate;
        // Large jumps are seeks/sleep, not playback. Never count a video's
        // duration or its currentTime as accumulated time watched.
        if (
          !player.seeking &&
          type !== "seeking" &&
          elapsed > 0 &&
          elapsed <= 15_000 &&
          media > 0 &&
          media <= elapsed + 750
        ) {
          this.add(
            previous.session,
            previous.at,
            now,
            Math.min(elapsed, media),
            {
              from: previous.media,
              to: player.currentTime,
              durationSeconds: player.duration,
            },
          );
        }
      }
      this.previous = {
        player,
        session,
        at: now,
        media: player.currentTime,
        rate,
        playing:
          !player.paused &&
          !player.ended &&
          !player.seeking &&
          player.readyState >= 3 &&
          !["pause", "waiting", "seeking", "ended", "emptied"].includes(type),
      };
      if (
        (!wasQualified && session.watchedMilliseconds >= MINUTE) ||
        now - this.lastFlush >= 15_000 ||
        ["pause", "waiting", "seeking", "ended", "emptied"].includes(type)
      )
        void this.flush();
    }

    add(session, from, to, milliseconds, media) {
      session.watchedMilliseconds =
        (session.watchedMilliseconds || 0) + milliseconds;
      const span = to - from;
      for (let start = from; start < to; ) {
        const minute = Math.floor(start / MINUTE) * MINUTE;
        const end = Math.min(to, minute + MINUTE);
        const key = `${session.sessionId}:${minute}`;
        const snapshot = this.snapshots.get(key) || {
          session,
          minute,
          milliseconds: 0,
          from: start,
          to: end,
        };
        snapshot.milliseconds += (milliseconds * (end - start)) / span;
        if (
          media &&
          Number.isFinite(media.durationSeconds) &&
          media.durationSeconds > 0
        ) {
          snapshot.durationSeconds = media.durationSeconds;
          snapshot.mediaRanges ||= [];
          const range = [
            media.from + ((media.to - media.from) * (start - from)) / span,
            media.from + ((media.to - media.from) * (end - from)) / span,
          ].map((value) => Math.max(0, Math.min(media.durationSeconds, value)));
          const last = snapshot.mediaRanges.at(-1);
          if (last && Math.abs(last[1] - range[0]) < 0.01) last[1] = range[1];
          else if (range[1] > range[0]) snapshot.mediaRanges.push(range);
        }
        snapshot.to = end;
        this.snapshots.set(key, snapshot);
        this.pending.set(key, {
          ...snapshot,
          mediaRanges: snapshot.mediaRanges?.map((range) => [...range]),
          milliseconds: Math.floor(snapshot.milliseconds),
        });
        start = end;
      }
    }

    reset(discardUnqualified = false) {
      this.previous = null;
      // Ads interrupt the meter, but only leaving/replaying ends the playback.
      for (const [key, snapshot] of this.snapshots) {
        if (
          !discardUnqualified ||
          snapshot.session.watchedMilliseconds >= MINUTE
        )
          continue;
        this.snapshots.delete(key);
        this.pending.delete(key);
      }
      void this.flush();
    }

    async flush() {
      if (this.sending) return;
      this.sending = true;
      this.lastFlush = this.clock();
      try {
        for (const [key, snapshot] of this.pending) {
          if (!(snapshot.session.watchedMilliseconds >= MINUTE)) continue;
          if (!snapshot.milliseconds) {
            this.pending.delete(key);
            continue;
          }
          const response = await this.client.send({
            action: "youtube-watch-time",
            videoId: snapshot.session.videoId,
            sessionId: snapshot.session.sessionId,
            watchedMilliseconds: snapshot.session.watchedMilliseconds,
            title: snapshot.session.title,
            buckets: [
              {
                minute: snapshot.minute,
                milliseconds: snapshot.milliseconds,
                from: snapshot.from,
                to: snapshot.to,
                ...(snapshot.durationSeconds > 0
                  ? {
                      durationSeconds: snapshot.durationSeconds,
                      mediaRanges: snapshot.mediaRanges,
                    }
                  : {}),
              },
            ],
          });
          if (!response?.success) break;
          if (this.pending.get(key) === snapshot) this.pending.delete(key);
          if (snapshot.minute + MINUTE < this.clock() && !this.pending.has(key))
            this.snapshots.delete(key);
        }
      } catch {
        // Keep cumulative snapshots for the next player event to retry.
      } finally {
        this.sending = false;
      }
    }
  }
  watchmarker.WatchTimeTracker = WatchTimeTracker;
})();

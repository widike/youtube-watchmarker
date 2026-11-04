import {
  mergeVideo,
  normalizeVideo,
} from "../../extension/history/history-records.js";

// Lightweight provider for routing/title tests. Transaction durability is tested
// separately against Chrome's real IndexedDB implementation.
export function memoryHistory(initial = []) {
  const records = new Map(
    initial.map((video) => [video.strIdent, normalizeVideo(video)]),
  );
  const provider = {
    getVideo: async (id) => records.get(id),
    putVideo: async (video) => {
      records.set(
        video.strIdent,
        mergeVideo(records.get(video.strIdent), video),
      );
    },
    recordPlayback: async (id, title, playbackId, recoveredAt) => {
      const previous = await provider.getVideo(id);
      const eventId = `playback:${playbackId}`;
      const events = previous?.watchEvents || [];
      const seen = events.some((event) => event.eventId === eventId);
      if (recoveredAt && seen) return null;
      const timestamp = seen
        ? previous.intTimestamp
        : Math.max(previous?.intTimestamp || 0, recoveredAt || Date.now());
      const video = normalizeVideo({
        ...previous,
        strIdent: id,
        strTitle: title || previous?.strTitle || "",
        intTimestamp: timestamp,
        intImportedCount: previous?.intImportedCount || 0,
        watchEvents: seen
          ? events
          : [
              ...events,
              {
                eventId,
                watchedAt: timestamp,
                source: "playback",
                precision: "exact",
              },
            ],
      });
      await provider.putVideo(video);
      return provider.getVideo(id);
    },
  };
  return { provider, records };
}

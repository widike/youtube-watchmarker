import { DurationBackfill, DURATION_ALARM } from "../duration-backfill.js";
import { DurationStorage } from "../duration-storage.js";
import { Database } from "../bg-database.js";
import { databaseProviderFactory } from "../database-provider-factory.js";

export const durationStorage = new DurationStorage(() => Database.database);
export const durationBackfill = new DurationBackfill({
  storage: durationStorage,
  getVideos: () =>
    databaseProviderFactory
      .getCurrentProvider()
      .getAllVideos({ includeDeleted: true }),
  schedule: async (when) => {
    const existing = await chrome.alarms.get(DURATION_ALARM);
    if (!existing || existing.scheduledTime !== when)
      await chrome.alarms.create(DURATION_ALARM, { when });
  },
  clear: () => chrome.alarms.clear(DURATION_ALARM),
});

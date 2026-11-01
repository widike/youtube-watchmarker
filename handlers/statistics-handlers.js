import { createHandler } from "../handler-wrapper.js";
import { databaseProviderFactory } from "../database-provider-factory.js";
import { summarizeHistory } from "../history-statistics.js";
import { Database } from "../bg-database.js";
import { readWatchTime, saveWatchTime } from "../watch-time-storage.js";
import { durationStorage } from "../background/duration-runtime.js";

export const handleHistoryStatistics = createHandler(
  async (request) => {
    const provider = databaseProviderFactory.getCurrentProvider();
    const [videos, time, durations] = await Promise.all([
      provider.getAllVideos({ includeDeleted: true }),
      readWatchTime(Database.database),
      durationStorage.readCache(),
    ]);
    const statistics = summarizeHistory(videos, {
      period: request.period,
      time,
      durations,
    });
    return { statistics };
  },
  { name: "handleHistoryStatistics" },
);

export const handleYoutubeWatchTime = createHandler(
  async (request, sender) => {
    await saveWatchTime(Database.database, request, sender);
    return {};
  },
  { name: "handleYoutubeWatchTime" },
);

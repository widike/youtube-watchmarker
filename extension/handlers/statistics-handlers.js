import { createHandler } from "../shared/handler-wrapper.js";
import { databaseProviderFactory } from "../providers/database-provider-factory.js";
import { summarizeHistory } from "../history/history-statistics.js";
import { summarizePopupHistory } from "../history/history-popup-statistics.js";
import { Database } from "../background/bg-database.js";
import { readWatchTime, saveWatchTime } from "../history/watch-time-storage.js";
import { durationStorage } from "../background/duration-runtime.js";

export const handleHistoryStatistics = createHandler(
  async (request) => {
    const provider = databaseProviderFactory.getCurrentProvider();
    const [videos, time, durations] = await Promise.all([
      provider.getAllVideos({ includeDeleted: true }),
      readWatchTime(Database.database),
      durationStorage.readCache(),
    ]);
    const summarize = request.compact
      ? summarizePopupHistory
      : summarizeHistory;
    const statistics = summarize(videos, {
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

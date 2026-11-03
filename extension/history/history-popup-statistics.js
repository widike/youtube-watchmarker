import { activityEntries } from "./history-activity.js";
import { estimateHistoryTime } from "../duration/duration-estimates.js";
import { summarizeWatchTime } from "./watch-time-statistics.js";
import { DAY } from "../statistics/statistics-dates.js";

// The popup only needs three rolling totals. Avoid dashboard calendars, word
// analysis, favorites and rhythms while the history list is opening.
export function summarizePopupHistory(
  videos,
  { now = Date.now(), time = [], durations = [] } = {},
) {
  const periods = { day: 1, week: 7, month: 30 };
  const totals = { day: 0, week: 0, month: 0 };
  for (const entry of activityEntries(videos, now)) {
    if (!entry.intTimestamp || entry.intTimestamp > now || entry.unknownViews)
      continue;
    for (const [period, days] of Object.entries(periods))
      if (entry.intTimestamp >= now - days * DAY) totals[period]++;
  }
  const estimates = estimateHistoryTime(videos, time, durations, now);
  return {
    period: "month",
    totals,
    time: summarizeWatchTime([...time, ...estimates.rows], videos, {
      period: "month",
      now,
      compact: true,
    }),
  };
}

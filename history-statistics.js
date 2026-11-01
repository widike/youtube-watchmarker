import { activityEntries } from "./history-activity.js";
import { isDeleted } from "./history-records.js";
import {
  calendarDays,
  dayKey,
  localDate,
  PERIODS,
  DAY,
} from "./statistics-dates.js";
import { commonWords } from "./statistics-words.js";
import { summarizeWatchTime } from "./watch-time-statistics.js";
import { estimateHistoryTime } from "./duration-estimates.js";

function streaks(days, today) {
  let longest = 0;
  let run = 0;
  let previous = "";
  for (const key of days) {
    const date = localDate(key);
    date.setDate(date.getDate() - 1);
    run = dayKey(date) === previous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = key;
  }
  const active = new Set(days);
  const date = localDate(today);
  if (!active.has(today)) date.setDate(date.getDate() - 1);
  let current = 0;
  while (active.has(dayKey(date))) {
    current++;
    date.setDate(date.getDate() - 1);
  }
  return { current, longest };
}

/** Aggregate the complete saved library, never a search result or page. */
export function summarizeHistory(
  videos,
  { period = "month", now = Date.now(), time = [], durations = [] } = {},
) {
  if (!Object.hasOwn(PERIODS, period)) period = "month";
  const duration = PERIODS[period].days * DAY;
  const start = period === "all" ? 0 : now - duration;
  const days = new Map();
  const selectedDays = new Map();
  const unique = new Map();
  const rhythm = Array(168).fill(0);
  const totals = Object.fromEntries(
    Object.keys(PERIODS).map((key) => [key, 0]),
  );
  let unknown = 0;
  let approximate = 0;
  let exact = 0;
  let previous = 0;
  let selected = 0;
  let future = 0;

  for (const video of videos) {
    if (isDeleted(video)) continue;
    for (const entry of activityEntries([video], now)) {
      if (entry.unknownViews) {
        unknown += entry.unknownViews;
        continue;
      }
      if (!entry.intTimestamp) continue;
      if (entry.intTimestamp > now) {
        future++;
        continue;
      }
      const key = dayKey(entry.intTimestamp);
      days.set(key, (days.get(key) || 0) + 1);
      for (const [name, range] of Object.entries(PERIODS))
        if (!range.days || entry.intTimestamp >= now - range.days * DAY)
          totals[name]++;
      if (
        period !== "all" &&
        entry.intTimestamp >= start - duration &&
        entry.intTimestamp < start
      )
        previous++;
      if (entry.intTimestamp < start) continue;
      selected++;
      selectedDays.set(key, (selectedDays.get(key) || 0) + 1);
      const row = unique.get(video.strIdent) || {
        strIdent: video.strIdent,
        strTitle: video.strTitle,
        count: 0,
      };
      row.count++;
      unique.set(video.strIdent, row);
      if (entry.watchPrecision !== "exact") {
        approximate++;
        continue;
      }
      exact++;
      const date = new Date(entry.intTimestamp);
      rhythm[((date.getDay() + 6) % 7) * 24 + date.getHours()]++;
    }
  }

  const daily = [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
  const first = daily[0]?.date || null;
  const selectedStart = start || (first ? localDate(first).getTime() : now);
  const dates = calendarDays(selectedStart, now);
  const weekdays = Array(7).fill(0);
  for (const key of dates) weekdays[(localDate(key).getDay() + 6) % 7]++;
  const weekdayCounts = Array(7).fill(0);
  for (const [key, count] of selectedDays)
    weekdayCounts[(localDate(key).getDay() + 6) % 7] += count;
  const weekdayAverages = weekdayCounts.map((count, index) => ({
    count,
    average: count / (weekdays[index] || 1),
  }));
  const averageWeek = rhythm.map((count, index) => ({
    count,
    average: count / (weekdays[Math.floor(index / 24)] || 1),
  }));
  const busiest = [...selectedDays].sort(
    (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
  )[0];
  const statistics = {
    period,
    now,
    start: selectedStart,
    first,
    totals,
    selected,
    previous,
    unique: unique.size,
    activeDays: selectedDays.size,
    average: selected / (PERIODS[period].days || dates.length),
    exact,
    approximate,
    unknown,
    future,
    daily,
    averageWeek,
    weekdayAverages,
    timeline: [...selectedDays]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
    weekdays,
    streak: streaks(
      daily.map(({ date }) => date),
      dayKey(now),
    ),
    busiest: busiest ? { date: busiest[0], count: busiest[1] } : null,
    favorites: [...unique.values()]
      .sort((a, b) => b.count - a.count || a.strTitle.localeCompare(b.strTitle))
      .slice(0, 5),
    words: commonWords([...unique.values()]),
  };
  const estimates = estimateHistoryTime(videos, time, durations, now);
  statistics.time = summarizeWatchTime(
    [...time, ...estimates.rows],
    videos,
    statistics,
  );
  statistics.time.missingDaily = estimates.missingDaily;
  return statistics;
}

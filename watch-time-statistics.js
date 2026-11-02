import {
  calendarDays,
  dayKey,
  localDate,
  PERIODS,
  DAY,
} from "./statistics-dates.js";
import { budgetWatchTime } from "./watch-time-budgets.js";

export function summarizeWatchTime(rows, videos, { period, now }) {
  const duration = PERIODS[period].days * DAY;
  const cutoff = period === "all" ? 0 : now - duration;
  const deleted = new Map(
    videos
      .filter((video) => video.intDeletedAt)
      .map((video) => [video.strIdent, video.intDeletedAt]),
  );
  const daily = new Map();
  const timeline = new Map();
  const rhythm = Array(168).fill(0);
  let selected = 0;
  let estimated = 0;
  let estimatedTotal = 0;
  let firstAt = Infinity;
  const eligible = rows.filter(
    (row) =>
      row.from > (deleted.get(row.strIdent) || 0) &&
      row.to <= now &&
      Number.isFinite(row.milliseconds) &&
      row.milliseconds > 0 &&
      (row.estimated ? row.to >= row.from : row.to > row.from),
  );
  const all = budgetWatchTime(eligible, 0, now);
  const valid = all.map(({ row, count }) =>
    row.estimated ? { ...row, milliseconds: count * 3_600_000 } : row,
  );
  const sum = (values) => values.reduce((total, { count }) => total + count, 0);
  const totals = Object.fromEntries(
    Object.entries(PERIODS).map(([name, range]) => [
      name,
      sum(budgetWatchTime(valid, range.days ? now - range.days * DAY : 0, now)),
    ]),
  );
  const previous =
    period === "all"
      ? 0
      : sum(budgetWatchTime(valid, cutoff - duration, cutoff, true));
  for (const { row, date, count } of all) {
    if (!count) continue;
    firstAt = Math.min(firstAt, row.from);
    if (row.estimated) estimatedTotal += count;
    daily.set(date, (daily.get(date) || 0) + count);
  }
  for (const { row, date: key, count } of budgetWatchTime(valid, cutoff, now)) {
    if (!count) continue;
    selected += count;
    if (row.estimated) estimated += count;
    timeline.set(key, (timeline.get(key) || 0) + count);
    const date = new Date(row.minute);
    if (!row.estimated || row.exactHour)
      rhythm[((date.getDay() + 6) % 7) * 24 + date.getHours()] += count;
  }
  const first = Number.isFinite(firstAt) ? dayKey(firstAt) : null;
  const start = cutoff || (first ? localDate(first).getTime() : now);
  const dates = calendarDays(start, now);
  const weekdays = Array(7).fill(0);
  for (const date of dates) weekdays[(localDate(date).getDay() + 6) % 7]++;
  const points = (map) =>
    [...map]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  const busiest = [...timeline].sort((a, b) => b[1] - a[1])[0];
  return {
    selected,
    estimated,
    estimatedTotal,
    previous,
    first,
    firstAt: first ? firstAt : null,
    start,
    totals,
    daily: points(daily),
    timeline: points(timeline),
    weekdays,
    average: selected / (PERIODS[period].days || dates.length),
    averageWeek: rhythm.map((count, index) => ({
      count,
      average: count / (weekdays[Math.floor(index / 24)] || 1),
    })),
    busiest: busiest ? { date: busiest[0], count: busiest[1] } : null,
  };
}

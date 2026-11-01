import {
  calendarDays,
  dayKey,
  localDate,
  PERIODS,
  DAY,
} from "./statistics-dates.js";

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
  const totals = Object.fromEntries(
    Object.keys(PERIODS).map((key) => [key, 0]),
  );
  let selected = 0;
  let estimated = 0;
  let estimatedTotal = 0;
  let previous = 0;
  let firstAt = Infinity;
  for (const row of rows) {
    if (
      row.from <= (deleted.get(row.strIdent) || 0) ||
      row.to > now ||
      (row.estimated ? row.to !== row.from : row.to <= row.from)
    )
      continue;
    firstAt = Math.min(firstAt, row.from);
    const count = row.milliseconds / 3_600_000;
    if (row.estimated) estimatedTotal += count;
    const key = dayKey(row.minute);
    daily.set(key, (daily.get(key) || 0) + count);
    // Imported lengths are assigned to their dated watch occurrence. Actual
    // minute snapshots retain their measured span and boundary proration.
    const portion = (start, end) =>
      row.estimated
        ? row.from >= start && row.from <= end
          ? count
          : 0
        : (Math.max(0, Math.min(row.to, end) - Math.max(row.from, start)) /
            (row.to - row.from)) *
          count;
    for (const [name, range] of Object.entries(PERIODS))
      totals[name] += portion(range.days ? now - range.days * DAY : 0, now);
    previous +=
      period === "all"
        ? 0
        : portion(cutoff - duration, row.estimated ? cutoff - 1 : cutoff);
    const value = portion(cutoff, now);
    if (!value) continue;
    selected += value;
    if (row.estimated) estimated += value;
    timeline.set(key, (timeline.get(key) || 0) + value);
    const date = new Date(row.minute);
    if (!row.estimated || row.exactHour)
      rhythm[((date.getDay() + 6) % 7) * 24 + date.getHours()] += value;
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

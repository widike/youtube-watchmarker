import { dayKey, localDate, nextDay } from "./statistics-dates.js";

const HOUR = 3_600_000;

/** Bound inferred viewing, never measured playback, to elapsed time per day. */
export function budgetWatchTime(rows, start, end, excludeEnd = false) {
  const days = new Map();
  const values = [];
  for (const row of rows) {
    const fraction =
      row.to === row.from
        ? Number(
            row.from >= start &&
              (excludeEnd ? row.from < end : row.from <= end),
          )
        : Math.max(0, Math.min(row.to, end) - Math.max(row.from, start)) /
          (row.to - row.from);
    const count = (row.milliseconds / HOUR) * fraction;
    if (!(count > 0)) continue;
    const date = dayKey(row.minute);
    if (!days.has(date)) {
      const midnight = localDate(date);
      days.set(date, {
        available:
          Math.max(
            0,
            Math.min(end, nextDay(midnight).getTime()) -
              Math.max(start, midnight.getTime()),
          ) / HOUR,
        measured: 0,
        estimated: 0,
      });
    }
    const day = days.get(date);
    day[row.estimated ? "estimated" : "measured"] += count;
    values.push({ row, date, count });
  }
  return values.map(({ row, date, count }) => {
    const day = days.get(date);
    const scale = row.estimated
      ? Math.min(1, Math.max(0, day.available - day.measured) / day.estimated)
      : 1;
    return { row, date, count: count * scale };
  });
}

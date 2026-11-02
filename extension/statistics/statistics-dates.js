export const DAY = 86_400_000;
export const PERIODS = {
  day: { label: "Past 24 hours", days: 1 },
  week: { label: "Past 7 days", days: 7 },
  month: { label: "Past 30 days", days: 30 },
  quarter: { label: "Past 90 days", days: 90 },
  year: { label: "Past 365 days", days: 365 },
  all: { label: "All time", days: null },
};

// Imported timestamps retain their time of day even when their source is
// inferred. Only explicit day-only records and unqualified local midnights
// lack an hour, matching the dates shown in the history library.
export function hasWatchHour(timestamp, precision) {
  const date = new Date(Number(timestamp));
  return (
    Number(timestamp) > 0 &&
    Number.isFinite(date.getTime()) &&
    precision !== "day" &&
    (precision === "exact" ||
      date.getHours() !== 0 ||
      date.getMinutes() !== 0 ||
      date.getSeconds() !== 0 ||
      date.getMilliseconds() !== 0)
  );
}

export function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Advance calendar dates, not 24-hour durations: DST days can have 23/25 hours.
export function nextDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

export function calendarDays(start, end) {
  const days = [];
  for (let date = localDate(dayKey(start)); date <= end; date = nextDay(date))
    days.push(dayKey(date));
  return days;
}

// @ts-check

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function describeWatchDate(timestamp, fullDate = false, precision) {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0)
    return null;
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return null;

  // YouTube history supplies calendar dates as local midnight. The stored
  // timestamp has no precision flag, so never present midnight as an exact time.
  const dateOnly =
    precision === "day" ||
    (precision !== "exact" &&
      date.getHours() === 0 &&
      date.getMinutes() === 0 &&
      date.getSeconds() === 0 &&
      date.getMilliseconds() === 0);
  if (dateOnly) {
    const datetime = [
      String(date.getFullYear()).padStart(4, "0"),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    return {
      datetime,
      label: fullDate ? dateFormatter.format(date) : "",
      title: `Watch date: ${dateFormatter.format(date)}; exact time unavailable`,
    };
  }
  return {
    datetime: date.toISOString(),
    label: fullDate
      ? fullDateFormatter.format(date)
      : timeFormatter.format(date),
    title: `Watched: ${fullDateFormatter.format(date)}`,
  };
}

// @ts-check

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const compactDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});

export function formatWatchTimestamp(value, variant = "full") {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return variant === "compact"
    ? compactDateFormatter.format(date)
    : fullDateFormatter.format(date);
}

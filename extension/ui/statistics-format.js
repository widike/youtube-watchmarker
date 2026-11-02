export const number = (value, digits = 0) =>
  Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
export const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export const dateLabel = (key) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export function duration(hours) {
  const seconds = Math.round(hours * 3600);
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

export const hours = (value) =>
  value > 0 && value < 0.01 ? "<0.01" : number(value, 2);
export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function comparison(current, previous, noun = "watches") {
  if (!previous)
    return current
      ? `No ${noun} in previous period`
      : "No change from previous period";
  const delta = ((current - previous) / previous) * 100;
  return `${delta > 0 ? "+" : ""}${number(delta, 1)}% vs previous period`;
}

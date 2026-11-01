import { duration, escape } from "./statistics-format.js";

const periods = [
  ["day", "24h", "24 hours"],
  ["week", "7d", "7 days"],
  ["month", "30d", "30 days"],
];

function watchTime(stats, period) {
  const hours = stats.time.totals[period];
  const estimated = stats.time.estimatedTotal > 0;
  const minutes = Math.floor(hours * 60);
  const unit = (value, label) =>
    `${value}<span class="stats-peek-unit">${label}</span>`;
  const value =
    hours > 0 && minutes < 1
      ? `&lt;${unit(1, "m")}`
      : minutes >= 60
        ? `${unit(Math.floor(minutes / 60), "h")}${minutes % 60 ? ` ${unit(minutes % 60, "m")}` : ""}`
        : unit(minutes, "m");
  const available = hours > 0 || stats.totals[period] === 0;
  const description = available
    ? `Watch time: ${duration(hours)}${estimated ? " (estimated)" : ""}`
    : "No watch time recorded";
  return `<dd class="stats-peek-duration" title="${escape(description)}"><span class="stats-peek-duration-value" aria-hidden="true">${available ? `${estimated && hours > 0 ? '<span class="stats-peek-unit">≈ </span>' : ""}${value}` : "—"}</span><span class="visually-hidden">${escape(description)}</span></dd>`;
}

export function popupStatistics(stats) {
  return `<dl class="stats-peek-values">${periods
    .map(
      ([period, label, fullLabel]) =>
        `<div class="stats-peek-metric"><dt title="Last ${fullLabel}" aria-label="Last ${fullLabel}">${label}</dt>${watchTime(stats, period)}</div>`,
    )
    .join("")}</dl>`;
}

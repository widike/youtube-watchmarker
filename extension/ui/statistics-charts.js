import { calendarDays, localDate } from "../statistics/statistics-dates.js";
import { dateLabel, duration, hours, escape } from "./statistics-format.js";

export function timelineData(stats) {
  const dates = calendarDays(stats.start, stats.now);
  const monthly = dates.length > 100;
  const buckets = new Map();
  for (const date of dates) {
    const key = monthly ? date.slice(0, 7) : date;
    if (!buckets.has(key)) buckets.set(key, 0);
  }
  // Selected period boundaries are applied in the aggregate, including 24h.
  for (const { date, count } of stats.timeline) {
    const key = monthly ? date.slice(0, 7) : date;
    buckets.set(key, (buckets.get(key) || 0) + count);
  }
  return {
    monthly,
    points: [...buckets].map(([date, count]) => ({ date, count })),
  };
}

export function timeline(stats) {
  const { points, monthly } = timelineData({ ...stats, ...stats.time });
  const max = Math.max(0.01, ...points.map(({ count }) => count));
  const width = 760;
  const height = 150;
  const step = width / points.length;
  const label = (date) =>
    monthly
      ? localDate(`${date}-01`).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
        })
      : dateLabel(date);
  const description = points.map(
    ({ date, count }) => `${label(date)}: ${duration(count)}`,
  );
  const bars = points
    .map(({ date, count }, index) => {
      const x = index * step;
      const barHeight = (count / max) * height;
      return `<g class="stats-timeline-bucket">
        <rect class="stats-timeline-bar" x="${x + step * 0.15}" y="${height - barHeight}" width="${step * 0.7}" height="${barHeight}" rx="${Math.min(3, step * 0.2)}"/>
        <rect x="${x}" y="0" width="${step}" height="${height}" fill="none" pointer-events="all" data-stats-tooltip="${escape(`${label(date)}: ${hours(count)} h`)}"/>
      </g>`;
    })
    .join("");
  return `<div class="section-heading"><h2>Viewing time</h2></div>
    <div class="stats-timeline" data-stats-tooltip-region>
      <span>${hours(max)} h</span>
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-describedby="stats-timeline-values" aria-label="${monthly ? "Monthly" : "Daily"} hours watched, from ${escape(label(points[0].date))} to ${escape(label(points.at(-1).date))}.">
        <desc id="stats-timeline-values">${escape(description.join("; "))}</desc>
        <line x1="0" x2="${width}" y1="${height / 2}" y2="${height / 2}" class="stats-gridline"/>
        ${bars}
      </svg>
      <div class="stats-tooltip" aria-hidden="true" hidden></div>
      <span>0</span>
    </div>
    <div class="stats-axis"><span>${escape(label(points[0].date))}</span><span>${escape(label(points.at(-1).date))}</span></div>`;
}

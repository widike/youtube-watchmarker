import { PERIODS } from "../statistics-dates.js";
import {
  comparison,
  duration,
  hours,
  escape,
  number,
} from "./statistics-format.js";
import {
  averageWeek,
  calendar,
  calendarLegend,
} from "./statistics-heatmaps.js";
import { timeline } from "./statistics-charts.js";
import { wordCloud } from "./statistics-word-cloud.js";

export function dashboard(stats) {
  const metric = (label, value, detail) =>
    `<article class="surface-card stats-metric" title="${escape(detail)}"><span>${label}</span><strong>${value}</strong></article>`;
  const firstDate = [stats.first, stats.time.first].filter(Boolean).sort()[0];
  const firstYear = firstDate
    ? Number(firstDate.slice(0, 4))
    : new Date(stats.now).getFullYear();
  const currentYear = new Date(stats.now).getFullYear();
  const years = Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => currentYear - index,
  );
  const change =
    stats.period === "all"
      ? "Dated activity in your saved library"
      : comparison(stats.selected, stats.previous, "records");
  const measured = stats.time.selected > 0;
  const timeChange =
    stats.time.estimated > 0
      ? "Includes history estimates ending when the next video starts, capped by video length and elapsed time. Date-only records use video lengths within a shared daily budget. Estimates are Watchmarker calculations, not YouTube watch-time data."
      : stats.period === "all"
        ? "Measured across synced devices"
        : `${comparison(stats.time.selected, stats.time.previous, "playback time")} · all devices`;
  return `<div class="stats-metrics${measured ? "" : " stats-metrics-counts"}">
    ${measured ? metric("Hours watched", `${stats.time.estimated > 0 ? "≈ " : ""}${escape(hours(stats.time.selected))} <em>h</em>`, timeChange) + metric("Daily viewing time", `${stats.time.estimated > 0 ? "≈ " : ""}${duration(stats.time.average)}`, stats.time.estimated > 0 ? timeChange : "Average playback time per day") : ""}
    ${metric("Recorded activity", number(stats.selected), change)}
    ${metric("Different videos", number(stats.unique), "Distinct videos in this period")}
    </div>
    ${!stats.selected && !stats.time.selected ? '<div class="stats-empty"><strong>No recorded viewing in this period.</strong><p><a href="#sync">Sync history</a></p></div>' : ""}
    ${measured ? `<section class="surface-card stats-card stats-timeline-card">${timeline(stats)}</section>` : ""}
    <section class="surface-card stats-card">${averageWeek(stats)}</section>
    <div class="stats-bottom-grid"><section class="surface-card stats-card stats-word-card"><div class="section-heading"><h2>Title words</h2></div>${wordCloud(stats)}</section>
    <section class="surface-card stats-card"><div class="section-heading"><h2>Most-recorded videos</h2></div><ol class="stats-favorites">${stats.favorites.map((video, index) => `<li><span class="stats-rank">${String(index + 1).padStart(2, "0")}</span><a href="https://www.youtube.com/watch?v=${encodeURIComponent(video.strIdent)}" target="_blank" rel="noopener noreferrer">${escape(video.strTitle || "Untitled video")}<span class="visually-hidden"> (opens in a new tab)</span></a><strong aria-label="${number(video.count)} records">${number(video.count)}</strong></li>`).join("") || "<li>No dated activity in this period.</li>"}</ol></section></div>
    <section class="surface-card stats-card stats-calendar-card"><div class="section-heading"><h2>Watch calendar</h2></div>${years.map((year) => `<section class="stats-calendar-year" aria-labelledby="stats-calendar-${year}">${calendar(stats, year)}</section>`).join("")}
    ${calendarLegend(stats)}
    <p class="visually-hidden" data-cell-detail aria-live="polite"></p></section>`;
}

export function periodControls() {
  return Object.entries(PERIODS)
    .map(
      ([key, { label }]) =>
        `<button type="button" data-stats-period="${key}" aria-pressed="${key === "month"}">${escape(label)}</button>`,
    )
    .join("");
}

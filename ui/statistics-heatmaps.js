import { calendarDays, localDate } from "../statistics-dates.js";
import {
  dateLabel,
  duration,
  escape,
  number,
  weekdays,
} from "./statistics-format.js";

const level = (value, max) =>
  value ? Math.min(4, Math.ceil((value / (max || 1)) * 4)) : 0;
const calendarLevel = (value) =>
  !value ? 0 : value < 0.25 ? 1 : value < 1 ? 2 : value < 3 ? 3 : 4;
const watchLevel = (value) =>
  !value ? 0 : value < 5 ? 1 : value < 10 ? 2 : value < 20 ? 3 : 4;
const cell = (label, intensity, index, missing = false) =>
  `<button type="button" class="stats-cell${missing ? " stats-cell-missing" : ""}" data-level="${intensity}" tabindex="${index ? -1 : 0}" aria-label="${escape(label)}" title="${escape(label)}"></button>`;

export function averageWeek(stats) {
  // Duration coverage must not hide records with a known viewing hour.
  const columns = 24;
  const week = stats.averageWeek;
  const max = Math.max(0, ...week.map(({ average }) => average));
  const labels = week.map(({ average }, index) => {
    const hour = index % columns;
    return `${weekdays[Math.floor(index / columns)]} ${String(hour).padStart(2, "0")}:00 · ${number(average, 2)} records/day on average`;
  });
  return `<div class="section-heading"><h2>Average week</h2></div>
    <div class="stats-week-summary" aria-label="Average records per weekday">${stats.weekdayAverages.map(({ average }, index) => `<div title="${weekdays[index]} · ${number(average, 2)} records/day"><span>${weekdays[index]}</span><strong>${number(average, 2)}</strong></div>`).join("")}</div>
    <p class="stats-week-note">Records per day</p>
    <div class="stats-heatmap-scroll"><div class="stats-week-hours" aria-hidden="true"><span></span>${Array.from({ length: 24 }, (_, hour) => `<span>${hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}</span>`).join("")}</div><div class="stats-week-layout"><div class="stats-week-labels" aria-hidden="true">${weekdays.map((day) => `<span>${day}</span>`).join("")}</div><div class="stats-week-grid" data-heatmap="week" data-columns="${columns}" role="group" aria-label="Average week. Records per day by local hour. Use arrow keys to explore hours and days.">${week.map(({ average }, index) => cell(labels[index], level(average, max), index)).join("")}</div></div></div>
    <p class="visually-hidden" data-cell-detail aria-live="polite"></p>`;
}

export function calendar(stats, year) {
  // Year calendars always describe the complete saved history. The rolling
  // period controls apply to the other charts, not to these annual totals.
  const counts = new Map(stats.daily.map(({ date, count }) => [date, count]));
  const time = new Map(
    stats.time.daily.map(({ date, count }) => [date, count]),
  );
  const first = new Date(year, 0, 1);
  const last = new Date(Math.min(new Date(year, 11, 31).getTime(), stats.now));
  const days = calendarDays(first, last);
  const offset = (first.getDay() + 6) % 7;
  const months = days.filter((date) => date.endsWith("-01"));
  const watches = days.reduce((sum, date) => sum + (counts.get(date) || 0), 0);
  const total = days.reduce((sum, date) => sum + (time.get(date) || 0), 0);
  const hasTime = (date) => (time.get(date) || 0) > 0;
  const missing = new Map(
    (stats.time.missingDaily || []).map(({ date, count }) => [date, count]),
  );
  const detail = (date) =>
    [
      hasTime(date)
        ? duration(time.get(date))
        : `${number(counts.get(date) || 0)} activity records`,
      missing.has(date)
        ? `${number(missing.get(date))} watches without duration`
        : "",
      hasTime(date) ? `${number(counts.get(date) || 0)} activity records` : "",
    ]
      .filter(Boolean)
      .join("; ");
  return `<div class="stats-calendar-summary"><h3 id="stats-calendar-${year}">${year}</h3><span>${total > 0 ? `${duration(total)}${days.some((date) => missing.has(date) || (!hasTime(date) && counts.get(date) > 0)) ? " (partial)" : ""} · ` : ""}${number(watches)} records</span></div>
    <div class="stats-heatmap-scroll"><div class="stats-calendar-months" aria-hidden="true">${months.map((date) => `<span style="grid-column:${Math.floor((days.indexOf(date) + offset) / 7) + 1}">${escape(localDate(date).toLocaleDateString(undefined, { month: "short" }))}</span>`).join("")}</div><div class="stats-calendar-layout"><div class="stats-week-labels" aria-hidden="true">${weekdays.map((day) => `<span>${day}</span>`).join("")}</div><div class="stats-calendar-grid" data-heatmap="calendar" role="group" aria-label="Daily viewing for ${year}. Arrow up/down move one day; left/right move one week.">${Array.from({ length: offset }, () => '<span aria-hidden="true"></span>').join("")}${days.map((date, index) => cell(`${dateLabel(date)}: ${detail(date)}`, hasTime(date) ? calendarLevel(time.get(date)) : watchLevel(counts.get(date) || 0), index, hasTime(date) && missing.has(date))).join("")}</div></div></div>`;
}

export function calendarLegend(stats) {
  const timedDays = new Set(
    stats.time.daily.filter(({ count }) => count > 0).map(({ date }) => date),
  );
  const measured = timedDays.size > 0;
  const counts = stats.daily.some(
    ({ date, count }) => count > 0 && !timedDays.has(date),
  );
  const scales = [];
  if (measured)
    scales.push([
      `Hours per day${stats.time.estimatedTotal > 0 ? " · includes estimates" : ""}`,
      ["0", "<¼ h", "¼–1 h", "1–3 h", "3+ h"],
    ]);
  if (counts || !measured)
    scales.push([
      `Records per day${measured ? " · when watch time is missing" : ""}`,
      ["0", "1–4", "5–9", "10–19", "20+"],
    ]);
  const label = scales.map(([label]) => label).join("; ");
  return `<div class="stats-legend" role="group" aria-label="${label}" title="${label}">${scales.map(([label, labels]) => `<div class="stats-legend-scale"><strong>${label}</strong>${labels.map((value, index) => `<span data-level="${index}">${escape(value)}</span>`).join("")}</div>`).join("")}</div>`;
}

export function bindHeatmaps(root) {
  root.querySelectorAll("[data-heatmap]").forEach((grid) => {
    const cells = [...grid.querySelectorAll("button")];
    const detail = grid
      .closest(".stats-card")
      .querySelector("[data-cell-detail]");
    const show = (button) => {
      if (button?.matches(".stats-cell")) {
        detail.textContent = button.getAttribute("aria-label");
      }
    };
    for (const event of ["focusin", "click", "pointerover"])
      grid.addEventListener(event, ({ target }) => show(target));
    grid.addEventListener("keydown", (event) => {
      const index = cells.indexOf(event.target);
      if (index < 0) return;
      const calendar = grid.dataset.heatmap === "calendar";
      const columns = Number(grid.dataset.columns);
      const delta = {
        ArrowLeft: calendar ? -7 : -1,
        ArrowRight: calendar ? 7 : 1,
        ArrowUp: calendar ? -1 : -columns,
        ArrowDown: calendar ? 1 : columns,
      }[event.key];
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? cells.length - 1
            : delta === undefined
              ? null
              : Math.max(0, Math.min(cells.length - 1, index + delta));
      if (next === null) return;
      event.preventDefault();
      cells[index].tabIndex = -1;
      cells[next].tabIndex = 0;
      cells[next].focus();
    });
    grid.addEventListener("focusin", ({ target }) => {
      if (!cells.includes(target)) return;
      cells.forEach((cell) => {
        cell.tabIndex = cell === target ? 0 : -1;
      });
    });
  });
}

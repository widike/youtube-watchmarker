import { describeWatchDate } from "./date-utils.js";
import { videoStatisticsMarkup } from "./history-video-statistics.js";
import { groupHistoryDays } from "./history-day-groups.js";

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const number = (value) => Number(value).toLocaleString();

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
}

export function historyDay(timestamp, now = new Date()) {
  if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return "";
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1,
  );
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return dayFormatter.format(date);
}

function watchDateMarkup(video, fullDate) {
  const date = describeWatchDate(
    video.intTimestamp,
    fullDate,
    video.watchPrecision,
  );
  return video.unknownViews
    ? ""
    : !date
      ? ""
      : date.label
        ? `<time class="video-watch-date" datetime="${date.datetime}" title="${escapeHtml(date.title)}"><i class="fas fa-clock" aria-hidden="true"></i><span class="visually-hidden">Watched: </span>${escapeHtml(date.label)}</time>`
        : "";
}

function repeatedMetadataMarkup(video, fullDate) {
  const plays = video.plays
    .map((play) => {
      const metadata = `${watchDateMarkup(play, fullDate)}${videoStatisticsMarkup({ ...play, durationSeconds: undefined })}`;
      return metadata ? `<span class="video-play">${metadata}</span>` : "";
    })
    .join("");
  return `${videoStatisticsMarkup({ durationSeconds: video.durationSeconds })}${plays ? `<span class="video-plays">${plays}</span>` : ""}`;
}

export function videoCard(video, fullDate, canDelete, index, total) {
  const id = String(video.strIdent || "");
  const title = escapeHtml(video.strTitle || "Untitled video");
  const valid = /^[A-Za-z0-9_-]{11}$/.test(id);
  const repeated = video.plays?.length > 1;
  const metadata = repeated
    ? repeatedMetadataMarkup(video, fullDate)
    : [
        watchDateMarkup(video, fullDate),
        video.unknownViews
          ? `<span>${number(video.unknownViews)} ${video.unknownViews === 1 ? "view" : "views"}</span>`
          : "",
        videoStatisticsMarkup(video),
      ]
        .filter(Boolean)
        .join("");
  const media = valid
    ? `<span class="video-thumbnail" aria-hidden="true"><i class="fas fa-play"></i><img data-src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" width="320" height="180" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`
    : "";
  const progress =
    !repeated && Number.isFinite(video.watchedPercent)
      ? `<span class="video-progress" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, video.watchedPercent))}%"></span></span>`
      : "";
  const content = `${media}<span class="video-copy"><span class="video-title">${title}</span>${metadata ? `<span class="video-meta">${metadata}</span>` : ""}</span>${progress}`;
  return `<li class="video-item" data-history-entry="${escapeHtml(video.entryId || id)}" aria-posinset="${index + 1}" aria-setsize="${total}">${valid ? `<a class="video-link" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer" aria-label="${title} (opens in a new tab)">${content}</a>` : `<div class="video-link">${content}</div>`}${canDelete ? `<button class="video-delete" data-video-delete="${escapeHtml(id)}" aria-label="Delete all watches of ${title} from shared history" title="Delete all watches of this video"><i class="fas fa-trash" aria-hidden="true"></i></button>` : ""}</li>`;
}

export function historyRows(results, { sort, columns }) {
  const rows = [];
  const groupDates = sort === "newest" || sort === "oldest";
  let day;
  let row;
  groupHistoryDays(results).forEach((video, index) => {
    const nextDay = groupDates ? historyDay(video.intTimestamp) : "";
    if (nextDay !== day) {
      day = nextDay;
      if (day) rows.push({ key: `day:${day}`, day });
      else if (rows.length) rows.push({ key: "day:undated", separator: true });
      row = null;
    }
    if (!row || row.videos.length === columns) {
      row = {
        key: video.entryId || video.strIdent,
        videos: [],
        fullDate: !groupDates,
      };
      rows.push(row);
    }
    row.videos.push({ video, index });
  });
  return rows;
}

export function emptyHistoryMarkup(state) {
  if (state.isSearching)
    return '<div class="history-empty"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i><p>Loading…</p></div>';
  if (state.loadError) return "";
  const filtered = state.currentQuery || state.period !== "all";
  return `<div class="history-empty"><span class="empty-icon"><i class="fas fa-${filtered ? "magnifying-glass" : "clock-rotate-left"}" aria-hidden="true"></i></span><h3>${filtered ? "No videos found" : "No watch history"}</h3><button class="primary-button" data-empty-action>${filtered ? "Clear filters" : "Sync history"}</button></div>`;
}

function duration(seconds) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, "0");
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function videoStatisticsMarkup(video) {
  const stats = [];
  if (Number.isFinite(video.durationSeconds) && video.durationSeconds > 0)
    stats.push(
      `<span class="video-duration" title="Video duration"><i class="fas fa-film" aria-hidden="true"></i><span class="visually-hidden">Duration: </span>${duration(video.durationSeconds)}</span>`,
    );
  if (
    Number.isFinite(video.watchedMilliseconds) &&
    video.watchedMilliseconds >= 1000
  )
    stats.push(
      `<span class="video-watched-time" title="Measured viewing time"><i class="fas fa-play" aria-hidden="true"></i><span class="visually-hidden">Watched: </span>${duration(video.watchedMilliseconds / 1000)}</span>`,
    );
  if (Number.isFinite(video.watchedPercent))
    stats.push(
      `<span class="video-percentage" title="Video played">${Math.max(0, Math.min(100, Math.round(video.watchedPercent)))}%<span class="visually-hidden"> watched</span></span>`,
    );
  return stats.join("");
}

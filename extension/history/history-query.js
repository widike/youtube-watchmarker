import { searchText } from "../shared/search-text.js";
import { titleWords } from "../statistics/statistics-words.js";

// Search and filtering happen before loading a batch, across the complete library.
export function queryHistory(
  videos,
  {
    query = "",
    wordGroup = "",
    period = "all",
    sort = "newest",
    now = Date.now(),
  } = {},
) {
  const term = searchText(query).trim();
  const group = wordGroup ? titleWords(wordGroup)[0] : null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = { today: 0, week: 6, month: 29 }[period];
  const cutoff =
    days === undefined
      ? 0
      : new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() - days,
        ).getTime();
  const matches = videos.filter((video) => {
    if (cutoff && (!video.intTimestamp || video.intTimestamp < cutoff))
      return false;
    if (group) return titleWords(video.strTitle).includes(group);
    return (
      !term ||
      searchText(`${video.strTitle || ""}\n${video.strIdent || ""}`).includes(
        term,
      )
    );
  });
  const recent = (a, b) =>
    (b.intTimestamp || 0) - (a.intTimestamp || 0) ||
    String(a.entryId || a.strIdent).localeCompare(
      String(b.entryId || b.strIdent),
    );
  const comparators = {
    newest: recent,
    oldest: (a, b) =>
      (a.intTimestamp || Infinity) - (b.intTimestamp || Infinity) ||
      recent(a, b),
    most: (a, b) => (b.intCount || 1) - (a.intCount || 1) || recent(a, b),
    title: (a, b) =>
      (a.strTitle || "").localeCompare(b.strTitle || "", undefined, {
        sensitivity: "base",
      }) || recent(a, b),
  };
  return matches.sort(comparators[sort] || recent);
}

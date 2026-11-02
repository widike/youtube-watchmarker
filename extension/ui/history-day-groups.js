import { dayKey } from "../statistics/statistics-dates.js";

// Group only the presentation. Session identities, measurements and pagination
// offsets continue to refer to the original watch entries.
export function groupHistoryDays(entries) {
  const groups = new Map();
  const cards = [];
  for (const entry of entries) {
    const timestamp = Number(entry.intTimestamp);
    if (
      entry.unknownViews ||
      !(timestamp > 0) ||
      !Number.isFinite(new Date(timestamp).getTime())
    ) {
      cards.push(entry);
      continue;
    }
    const key = `${entry.strIdent}:${dayKey(timestamp)}`;
    let card = groups.get(key);
    if (!card) {
      card = { ...entry, plays: [] };
      groups.set(key, card);
      cards.push(card);
    }
    card.plays.push(entry);
    if (!card.durationSeconds && entry.durationSeconds > 0)
      card.durationSeconds = entry.durationSeconds;
  }
  return cards;
}

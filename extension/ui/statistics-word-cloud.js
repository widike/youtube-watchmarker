import { escape, number } from "./statistics-format.js";

/** Square-root scaling moderates skew; the floor keeps rare words readable.
 * Anchor at zero, rather than stretching tiny differences to the full range.
 * Exact document counts are available in tooltips and accessible names.
 */
export function wordSize(count, maximum) {
  return Math.max(0.875, 2.25 * Math.sqrt(count / maximum));
}

export function wordCloud(stats) {
  const maximum = Math.max(1, ...stats.words.map(({ count }) => count));
  if (!stats.words.length)
    return '<p class="stats-word-empty">No repeated title words.</p>';
  return `<ol class="stats-word-cloud" role="list" aria-label="Top ${stats.words.length} repeated title words, most frequent first">${stats.words
    .map(({ word, count }) => {
      const label = `${escape(word)} · ${number(count)} different videos`;
      return `<li style="--word-size:${wordSize(count, maximum).toFixed(3)}rem"><button type="button" data-stats-word="${escape(word)}" title="${label}" aria-label="${label}. Search full library.">${escape(word)}</button></li>`;
    })
    .join("")}</ol>`;
}

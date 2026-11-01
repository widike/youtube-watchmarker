import { searchText } from "./shared/search-text.js";
import { wordFamilies } from "./shared/word-families.js";

// English/German function words and video boilerplate, not a topic taxonomy.
// Keep content words (including news, reviews and tutorials) and accents.
const STOP_WORDS = new Set(
  `
a an and are as at be been being but by can could did do does doing don't for
from get got had has have he her here hers him his how i if in into is isn't
it its it's just like me more most my no nor not of off on once one only or
other our out over own same she should so some such than that that's the
their them then there these they this those through to too under until up
us very was we were what when where which while who why will with won't
would you your you're yours also about all any each every new now really
video videos watch watching youtube shorts short full official part episode
ft feat vs via ep www http https com subscribe channel live
after again against before below between both down during few further
having itself myself ourselves themselves together yourself
yourselves getting gets made make makes making used uses using use
don't doesn't didn't haven't hasn't hadn't aren't weren't wasn't couldn't
wouldn't shouldn't mustn't needn't let's there's here's who's what's
i'm i've i'd i'll we're we've we'd we'll they're they've they'd they'll
you've you'd you'll that'll it'd
4k 8k 720p 1080p hd uhd hdr
aber alle allem allen aller alles als also am an auch auf aus bei bin bis
bist da damit dann das dass dein deine dem den der des die dies diese dieser
doch du durch ein eine einem einen einer eines er es etwas euch euer für
gegen geht gibt hab habe haben hat hatte hier hin ich im in ist ja jede
jeder jetzt kann kein keine kommt können macht mal man mehr mein meine mich
mir mit muss nach nicht noch nur ob oder ohne schon sehr sein seine sich
sie sind so über um und uns unser unter vom von vor war waren was weil
wenn werde werden wie wieder wir wird wo zu zum zur
`
    .trim()
    .split(/\s+/u),
);

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

export function titleWords(title) {
  const text = searchText(title).replace(/(?:https?:\/\/|www\.)\S+/gu, " ");
  const words = [];
  for (const { segment, index, isWordLike } of segmenter.segment(text)) {
    if (!isWordLike) continue;
    // Preserve technical names that the word segmenter separates from symbols.
    const suffix = text
      .slice(index + segment.length)
      .match(/^(?:\+\+|#)(?![\p{L}\p{N}+#])/u)?.[0];
    const word = STOP_WORDS.has(segment)
      ? segment
      : `${segment}${suffix || ""}`.replace(/'s$/u, "");
    const length = [...word].length;
    if (
      (length >= 2 || /\p{Script=Han}/u.test(word)) &&
      length <= 30 &&
      /\p{L}/u.test(word) &&
      !/^\d+(?:p|k|fps)$/u.test(word)
    )
      words.push(word);
  }
  return [
    ...new Set(wordFamilies(words).filter((word) => !STOP_WORDS.has(word))),
  ];
}

/** Document frequency: callers supply one row per different video in the period. */
export function commonWords(videos) {
  const counts = new Map();
  for (const video of videos)
    for (const word of titleWords(video.strTitle))
      counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts]
    .map(([word, count]) => ({ word, count }))
    .filter(({ count }) => count >= 2)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "en"))
    .slice(0, 40);
}

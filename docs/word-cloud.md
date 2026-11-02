# Title word cloud

The cloud summarizes recurring vocabulary in watched video titles. It measures
how broadly a word occurs across videos, rather than viewing duration or plays.

## Calculation

- Use the different videos with eligible watch events in the selected period.
  Count each normalized word once per video. Identical titles on separate videos
  still represent separate documents. Rewatches do not amplify title vocabulary.
- Apply Unicode NFKC normalization, fixed-locale lowercase and apostrophe
  normalization. Use `Intl.Segmenter` word boundaries, including scripts without
  spaces. Preserve accents, meaningful two-character terms and C++/C# suffixes.
  Remove English possessive suffixes, URLs, numbers, video-format labels and a
  curated English/German function-word and video-boilerplate list.
- Keep words occurring in at least two videos; return the top 40, with lexical
  tie-breaking. These thresholds reduce clutter, not statistical significance.
- Group English inflections with the WordNet-backed `wink-lemmatizer` and German
  forms with the 355,354-entry German table from `spacy-lookups-data`. Both return
  readable dictionary forms, including irregular verbs and plurals. Preserve
  umlauts, ß, accents and technical tokens. Resolve dictionary chains so inflected
  participles join the same verb family. Capitalized German noun collisions do
  not override explicit lowercase inflections or known infinitives.
- Use Franc, restricted to English/German, to select the preferred dictionary for
  a title. Words absent from it can use the other dictionary, supporting mixed
  titles. Very short titles default to English; short or ambiguous text can be
  misclassified. Lookup lemmatization has no part-of-speech disambiguation, and
  missing dictionary forms remain unchanged.
- Group English/German country names and demonyms using `world-countries` plus
  German geographic data from the Auswärtiges Amt and Lingolia. Handle adjective
  case endings and regular resident plurals across the dataset. The canonical
  country label stays the common English name, so bilingual titles do not create
  two entries for one country. Prefer country names over demonyms and
  independent countries over dependencies; equally plausible demonyms remain
  separate. This is a geographic grouping policy, not arbitrary synonym merging.
  There are no example-specific word mappings or fuzzy prefix matches.
- Deduplicate **after** normalization. A video containing several variants adds
  one to its family count; grouping never sums overlapping document frequencies.
- Use document frequency directly. TF–IDF answers how distinctive a term is to
  a document relative to a corpus; this card answers how many watched videos
  contain a word. There is no external background corpus to support a claim of
  topic importance. Filtering of function words is limited to English/German.

## Display

- Keep words horizontal, frequency ordered and consistently colored/weighted.
  Position, color and weight do not imply extra categories or semantic groups.
- Size in rem with `max(0.875, 2.25 × sqrt(count / maximum))`. The zero-anchored
  square-root scale moderates skew without stretching near ties across the full
  font range. The readability floor intentionally compresses very low counts;
  font size is not an exact quantitative comparison, and word length also
  affects apparent prominence.
- Keep the card minimal: heading, selected period and clickable words.
  Exact document counts are available in tooltips and accessible names.
- Keep the card sized to its contents, wrap at narrow widths, use theme colors
  with readable contrast and visible focus. No animation or external layout
  library is needed.
- Clicking a word searches the full library using the same word families.
  Pagination and filter changes retain that grouped search; editing the query
  restores ordinary literal search. Both apply the same Unicode normalization.

## Local language assets

`npm run build` bundles the English lemmatizer, German lookup table, language
detector and country names/demonyms into `extension/vendor/`. The runtime performs no
remote NLP requests and does not require Python or a spaCy installation. The
English bundle is about 1.7 MB and the packed German table about 4.6 MB. Node
builds from the checked-in compressed German source and pinned npm dependencies.
Third-party license files are copied alongside the assets.

`python3 scripts/refresh-german-language-data.py` explicitly refreshes source
snapshots under `data/word-language/`. The spaCy revision is pinned; geographic
sources are snapshotted with SHA-256 provenance in `sources.json`. Rebuild and
run the English/German tests after refreshing. Normal builds use local data.

The country data is derived from [mledoze/countries](https://github.com/mledoze/countries)
under ODbL 1.0; the derived country-family database retains that license.
The spaCy lookups, Franc, and Wink packages use MIT licenses. German geographic
snapshots contain factual country, adjective and resident names, with their
source URLs and checksums retained. No explanatory source prose is included.

## Research

Reviewed 1 November 2026:

- [Wink lemmatizer documentation](https://winkjs.org/wink-lemmatizer/):
  dictionary-backed noun, verb and adjective lemmatization.
- [spaCy lookup lemmatization](https://spacy.io/usage/linguistic-features#lemmatization)
  and [lookup data](https://github.com/explosion/spacy-lookups-data): established
  lookup lemmatization, including the German inflection table used here.
- [Franc](https://github.com/wooorm/franc): language detection with restricted
  candidate languages; accuracy is limited on short input.
- [Auswärtiges Amt country terminology](https://www.auswaertiges-amt.de/de/service/terminologie/215252-215252)
  and [Lingolia country/demonym table](https://deutsch.lingolia.com/en/vocabulary/laender-nationalitaeten):
  German country names, nationality adjectives and resident names.
- [World Countries schema](https://github.com/mledoze/countries#countries-data):
  maintained country names and gendered demonyms; reduced to the required fields
  during the build.
- [Stanford: Tokenization](https://nlp.stanford.edu/IR-book/html/htmledition/tokenization-1.html)
  and [stop words](https://nlp.stanford.edu/IR-book/html/htmledition/dropping-common-terms-stop-words-1.html):
  token boundaries and stop lists require choices appropriate to the corpus.
- [Stanford: Stemming and lemmatization](https://nlp.stanford.edu/IR-book/html/htmledition/stemming-and-lemmatization-1.html):
  morphological normalization involves precision/recall tradeoffs.
- [Ren et al., 2024: Multidirectional typography](https://doi.org/10.1016/j.displa.2024.102724):
  horizontal typography supports better readability than vertical/diagonal text.
- [Maurits et al., 2022: Interpretability in 234 individuals](https://doi.org/10.5220/0010778700003124):
  both font-size and word-area scaling produce substantial frequency-estimation
  errors. Exact counts and a quantitative alternative matter.
- [EU Data Visualisation Guide: Word clouds](https://data.europa.eu/apps/data-visualisation-guide/visualisation-of-text-word-clouds):
  word length biases emphasis; bars support frequency comparisons better.
- [MDN: Intl.Segmenter](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)
  and [String.normalize](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize):
  current browser APIs for segmentation and normalization, checked via Context7.

The exact top-word limit, font range, floor and stop list are product choices,
not universal research-prescribed constants.

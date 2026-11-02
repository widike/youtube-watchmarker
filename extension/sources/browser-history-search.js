const PAGE_SIZE = 1000;
const MAX_RESULTS = 2_147_483_647;

// Split saturated time ranges instead of assuming that one large maxResults
// request contains all history. Overlap boundaries and deduplicate URLs in the
// importer so equally timed visits cannot fall between pages.
export async function* searchBrowserHistory(
  startTime,
  endTime,
  { signal } = {},
) {
  for (const text of ["youtube.com", "youtu.be"]) {
    const ranges = [[startTime, endTime, PAGE_SIZE]];
    while (ranges.length) {
      signal?.throwIfAborted();
      const [start, end, limit] = ranges.pop();
      const results = await chrome.history.search({
        text,
        startTime: start,
        endTime: end,
        maxResults: limit,
      });
      signal?.throwIfAborted();
      if (!Array.isArray(results)) {
        throw new Error(
          "Browser history search returned no results array; sync is incomplete.",
        );
      }
      if (results.length < limit) {
        yield results;
        continue;
      }
      if (end - start <= 2) {
        // A timestamp shared by many URLs cannot be split further. Increase the
        // requested size until we can confirm the whole bucket was returned.
        if (limit === MAX_RESULTS) {
          throw new Error(
            "Browser history search limit reached; sync is incomplete.",
          );
        }
        ranges.push([start, end, Math.min(limit * 2, MAX_RESULTS)]);
        continue;
      }
      const middle = Math.floor(start + (end - start) / 2);
      ranges.push([start, middle + 1, PAGE_SIZE], [middle, end, PAGE_SIZE]);
    }
  }
}
